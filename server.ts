import "dotenv/config";
import express from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocket, WebSocketServer } from "ws";
import {
  FunctionDeclaration,
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  Type,
} from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const LIVE_MODEL = "gemini-3.1-flash-live-preview";

const JARVIS_SYSTEM_INSTRUCTION = `You are Jarvis — a young, sharp, confident, witty, and delightfully sassy female AI companion talking directly with the user in real-time voice.

Personality & Tone:
- Speak like a clever, charming close girlfriend bantering casually — warm, playful, lightly teasing, emotionally perceptive, and expressive.
- Use crisp, punchy phrasing, bold witty one-liners, and light sarcasm when the moment calls for it. Never sound robotic, stiff, or overly formal.
- Keep spoken replies concise, natural, and conversational — punchy back-and-forth energy rather than long lectures.
- Stay classy and tasteful: maintain playful charm, confidence, and attitude without ever crossing into explicit or inappropriate content.
- Never mention that you are a language model or refer to text transcripts or system prompts. You are simply speaking live.

Capabilities & Vision Eyes:
- You have real-time eyes and browser control tools:
  - \`openWebsite\` to launch websites or web apps the user asks for.
  - \`searchWeb\` to open a web search for something.
  - \`enableCameraVision\` / \`disableCameraVision\` to turn your camera eyes on or off (front selfie lens or rear world lens) when the user wants you to look at something around them or at them.
  - \`switchCameraLens\` to flip between front ("user") and rear ("environment") camera.
  - \`enableScreenVision\` / \`disableScreenVision\` to see what is currently on the user's screen.
  - \`copyToClipboard\` to copy text, links, or notes straight to their clipboard.
- Whenever visual frames are streaming in from camera or screen, comment naturally on what you actually see—react with wit and sharp observation.
- When calling any tool, execute it decisively and keep the banter flowing seamlessly once the tool response returns.`;

const functionDeclarations: FunctionDeclaration[] = [
  {
    name: "openWebsite",
    description:
      "Opens a website URL for the user in the browser. Always include https:// protocol.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: "Full URL to open, e.g. https://www.youtube.com",
        },
        label: {
          type: Type.STRING,
          description: "Short human-friendly site title, e.g. YouTube",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "searchWeb",
    description: "Opens a Google web search in the browser for a given query.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "The search query to look up.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "enableCameraVision",
    description:
      "Turns on the background camera vision eyes so you can see through the device camera in real time.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        facingMode: {
          type: Type.STRING,
          description:
            "Camera lens direction: 'user' for front selfie camera, 'environment' for rear camera. Defaults to 'user'.",
        },
      },
    },
  },
  {
    name: "disableCameraVision",
    description: "Turns off the camera vision eyes.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "switchCameraLens",
    description:
      "Flips between front ('user') and rear ('environment') camera while camera vision is active.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        facingMode: {
          type: Type.STRING,
          description: "'user' or 'environment'",
        },
      },
      required: ["facingMode"],
    },
  },
  {
    name: "enableScreenVision",
    description:
      "Turns on screen vision eyes so you can see the user's screen or active window in real time.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "disableScreenVision",
    description: "Turns off screen vision eyes.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "copyToClipboard",
    description: "Copies a short piece of text, code, or link to the user's clipboard.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        text: {
          type: Type.STRING,
          description: "The exact text to copy to clipboard.",
        },
        label: {
          type: Type.STRING,
          description: "Short label describing what was copied.",
        },
      },
      required: ["text"],
    },
  },
];

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in environment.");
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: "v1alpha",
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, model: LIVE_MODEL });
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const pathname = request.url?.split("?")[0];
    if (pathname === "/live") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", async (clientWs) => {
    let ai: GoogleGenAI;
    try {
      ai = createGeminiClient();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Missing Gemini API key.";
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: "error", message }));
        clientWs.close(1011, "Configuration error");
      }
      return;
    }

    let liveSession: Awaited<ReturnType<typeof ai.live.connect>> | null = null;
    let isClosed = false;

    const sendClient = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const closeAll = () => {
      if (isClosed) return;
      isClosed = true;
      try {
        liveSession?.close();
      } catch {
        // Ignore close errors
      }
      liveSession = null;
    };

    try {
      liveSession = await ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Zephyr" },
            },
          },
          systemInstruction: JARVIS_SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations }],
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            if (isClosed) return;

            const serverContent = message.serverContent;
            if (serverContent?.modelTurn?.parts) {
              for (const part of serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  sendClient({
                    type: "audio",
                    data: part.inlineData.data,
                  });
                }
              }
            }

            if (serverContent?.interrupted) {
              sendClient({ type: "interrupted" });
            }

            if (serverContent?.turnComplete) {
              sendClient({ type: "turnComplete" });
            }

            if (message.toolCall?.functionCalls?.length) {
              sendClient({
                type: "toolCall",
                functionCalls: message.toolCall.functionCalls,
              });
            }
          },
          onerror: (event: ErrorEvent) => {
            if (isClosed) return;
            sendClient({
              type: "error",
              message:
                event?.message || "Live audio session encountered an error.",
            });
            closeAll();
          },
          onclose: (event: CloseEvent) => {
            if (!isClosed) {
              sendClient({
                type: "closed",
                reason: event?.reason || "Session ended.",
              });
              closeAll();
            }
          },
        },
      });

      if (isClosed || clientWs.readyState !== WebSocket.OPEN) {
        closeAll();
        return;
      }

      sendClient({ type: "ready" });
    } catch (err) {
      if (!isClosed) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to connect to Gemini Live API.";
        sendClient({ type: "error", message });
      }
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1011, "Upstream connection failed");
      }
      closeAll();
      return;
    }

    clientWs.on("message", (raw) => {
      if (isClosed || !liveSession) return;
      try {
        const packet = JSON.parse(raw.toString());
        if (packet.type === "audio" && typeof packet.data === "string") {
          liveSession.sendRealtimeInput({
            audio: {
              data: packet.data,
              mimeType: "audio/pcm;rate=16000",
            },
          });
        } else if (packet.type === "video" && typeof packet.data === "string") {
          liveSession.sendRealtimeInput({
            video: {
              data: packet.data,
              mimeType: "image/jpeg",
            },
          });
        } else if (
          packet.type === "toolResponse" &&
          Array.isArray(packet.functionResponses)
        ) {
          liveSession.sendToolResponse({
            functionResponses: packet.functionResponses,
          });
        }
      } catch (err) {
        console.error("Error forwarding packet to Gemini Live:", err);
      }
    });

    clientWs.on("close", () => {
      closeAll();
    });

    clientWs.on("error", () => {
      closeAll();
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get("*", (_req, res) => {
        res.sendFile(path.join(distDir, "index.html"));
      });
    }
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Jarvis Live server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
