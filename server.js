import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import multer from "multer";
import fs from "fs";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const BASE_URL = `https://chat.botpress.cloud/${process.env.BOTPRESS_WEBHOOK_ID}`;

/*
----------------------------------------
HELPERS (BOTPRESS CHAT API)
----------------------------------------
*/

async function createUser() {
  const res = await fetch(`${BASE_URL}/users`, {
    method: "POST",
  });
  const data = await res.json();
  console.log("createUser:", data);
  if (!res.ok) {
    throw new Error(
      `createUser failed: ${res.status} ${JSON.stringify(data)}`
    );
  }
  const userKey = data.key;
  const userId = data.user?.id;
  if (!userKey || !userId) {
    throw new Error(`createUser: missing key or user id: ${JSON.stringify(data)}`);
  }
  return { userKey, userId };
}

async function createConversation(userKey) {
  const res = await fetch(`${BASE_URL}/conversations`, {
    method: "POST",
    headers: {
      "x-user-key": userKey,
    },
  });
  const data = await res.json();
  console.log("createConversation:", data);
  if (!res.ok) {
    throw new Error(
      `createConversation failed: ${res.status} ${JSON.stringify(data)}`
    );
  }
  const id = data.conversation?.id ?? data.id;
  if (!id) {
    throw new Error(
      `createConversation: missing conversation id: ${JSON.stringify(data)}`
    );
  }
  return id;
}

async function sendMessage(userKey, conversationId, text) {
  const res = await fetch(`${BASE_URL}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-key": userKey,
    },
    body: JSON.stringify({
      conversationId,
      payload: {
        type: "text",
        text: text,
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  console.log("sendMessage:", res.status, data);
  if (!res.ok) {
    throw new Error(
      `sendMessage failed: ${res.status} ${JSON.stringify(data)}`
    );
  }
}

/** Botpress list messages uses userId (not direction) to distinguish speakers. */
function textFromMessagePayload(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (payload.type === "text" && typeof payload.text === "string") {
    return payload.text;
  }
  if (payload.type === "markdown" && typeof payload.markdown === "string") {
    return payload.markdown;
  }
  return "";
}

async function getMessages(userKey, conversationId) {
  const res = await fetch(
    `${BASE_URL}/conversations/${conversationId}/messages`,
    {
      headers: {
        "x-user-key": userKey,
      },
    }
  );

  const data = await res.json().catch(() => ({}));
  console.log("getMessages RAW:", JSON.stringify(data, null, 2));

  // Handle multiple possible shapes
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.messages)) return data.messages;
  if (Array.isArray(data.items)) return data.items;

  return [];
}

/*
----------------------------------------
HEALTH CHECK
----------------------------------------
*/
app.get("/", (req, res) => {
  res.send("HGS Vision API running (stable)");
});

/*
----------------------------------------
MAIN ENDPOINT
----------------------------------------
*/
app.post("/identify", upload.single("image"), async (req, res) => {
  try {
    /*
    ----------------------------------------
    STEP 1: IMAGE → PRODUCT NAME
    ----------------------------------------
    */
    const imagePath = req.file.path;
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString("base64");

    const aiRes = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Identify the product in the image. Return ONLY the product name.",
            },
            {
              type: "input_image",
              image_url: `data:image/jpeg;base64,${base64Image}`,
            },
          ],
        },
      ],
    });

    const productName = aiRes.output_text?.trim() || "Unknown product";

    fs.unlinkSync(imagePath);

    console.log("Detected product:", productName);

    /*
    ----------------------------------------
    STEP 2: BOTPRESS FLOW
    ----------------------------------------
    */

    const { userKey, userId: endUserId } = await createUser();
    const conversationId = await createConversation(userKey);

    await sendMessage(userKey, conversationId, productName);

    /*
    ----------------------------------------
    STEP 3: POLL FOR RESPONSE
    ----------------------------------------
    */

    let botMessage = "No response";

    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));

      const messages = await getMessages(userKey, conversationId);

      if (Array.isArray(messages)) {
        const fromBot = messages
          .filter((m) => m.userId !== endUserId)
          .sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );

        if (fromBot.length > 0) {
          const last = fromBot[fromBot.length - 1];
          botMessage = textFromMessagePayload(last.payload) || "No response";

          console.log("Bot response found:", botMessage);
          break;
        }
      }
    }

    /*
    ----------------------------------------
    FINAL RESPONSE
    ----------------------------------------
    */
    res.json({
      product: productName,
      botpress: botMessage,
      status: "complete",
    });
  } catch (err) {
    console.error("ERROR:", err);
    res.status(500).json({ error: "Vision processing failed" });
  }
});

/*
----------------------------------------
START SERVER
----------------------------------------
*/
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HGS Vision running on port ${PORT}`);
});