import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  app.use(express.json());

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  app.post('/api/quiz', async (req, res) => {
    try {
      const { hyperlocal, lat, lng } = req.body;

      let response;
      let sources: any[] = [];

      if (hyperlocal) {
        // When using googleMaps tool, DO NOT set responseMimeType or responseSchema
        const userLat = lat || 37.78193;
        const userLng = lng || -122.40476;
        
        const prompt = `You are an expert alpine expedition guide and senior outdoor survival quizmaster. 
Generate a rigorous, highly challenging 4-question trivia quiz about real local geographical landmarks, mountain trails, elevation profiles, weather patterns, and rugged terrain features specifically around latitude ${userLat}, longitude ${userLng} (utilizing real nearby parks, peaks, rivers, or wilderness areas found via Google Maps). 
Make questions genuinely difficult and expert-level.
You MUST output the result as a valid JSON array and nothing else (wrapped in markdown json block or raw JSON), where each object has:
- "question" (string)
- "options" (array of 4 strings)
- "correctAnswer" (integer index 0 to 3)
- "explanation" (string)
`;

        response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            tools: [{ googleMaps: {} }],
            toolConfig: {
              retrievalConfig: {
                latLng: {
                  latitude: userLat,
                  longitude: userLng,
                },
              },
            },
          },
        });

        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (groundingChunks) {
          sources = groundingChunks
            .map((chunk: any) => chunk.maps || chunk.web)
            .filter(Boolean);
        }
      } else {
        // Standard mode: can use responseSchema & responseMimeType
        const prompt = `Generate a challenging 4-question multiple-choice outdoor survival, thermal insulation, and mountaineering gear quiz for outdoor enthusiasts.`;

        response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  options: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  correctAnswer: { type: Type.INTEGER },
                  explanation: { type: Type.STRING },
                },
                required: ['question', 'options', 'correctAnswer', 'explanation'],
              },
            },
          },
        });
      }

      let quizData = [];
      const rawText = response.text || '';
      
      try {
        let jsonStr = rawText.trim();
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          jsonStr = jsonMatch[1];
        }
        quizData = JSON.parse(jsonStr);
      } catch (err) {
        console.error('Failed to parse quiz JSON from text:', rawText);
        quizData = [
          {
            question: "What is the optimal temperature retention for vacuum-insulated 18/8 stainless steel flasks?",
            options: ["12h hot / 24h cold", "4h hot / 8h cold", "24h hot / 48h cold", "2h hot / 4h cold"],
            correctAnswer: 0,
            explanation: "Pro-grade double-wall vacuum insulation maintains drinks icy cold for 24 hours and piping hot for 12 hours."
          }
        ];
      }

      res.json({ quiz: quizData, sources, hyperlocal });
    } catch (error: any) {
      console.error('Quiz API error:', error);
      res.status(500).json({ error: error.message || 'Failed to generate quiz' });
    }
  });

  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const port = 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
  });
}

startServer();
