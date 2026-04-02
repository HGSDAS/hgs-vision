import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import multer from "multer";
import fs from "fs";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const BASE_URL = `https://chat.botpress.cloud/${process.env.BOTPRESS_WEBHOOK_ID}`;

const BOTPRESS_REPLY_WAIT_MS = Number(process.env.BOTPRESS_REPLY_WAIT_MS) || 15000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/*
----------------------------------------
HELPERS (BOTPRESS CHAT API)
----------------------------------------
*/

async function createUser() {
  const res = await fetch(`${BASE_URL}/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  const data = await res.json();
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
      "Content-Type": "application/json",
      "x-user-key": userKey,
    },
    body: JSON.stringify({}),
  });
  const data = await res.json();
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

/** Latest bot text/markdown message (ignores image/card-only replies that come after the text). */
function latestBotTextReply(messages, endUserId) {
  const withText = messages
    .filter((m) => m.userId !== endUserId)
    .map((m) => ({
      m,
      text: textFromMessagePayload(m.payload),
      t: new Date(m.createdAt).getTime(),
    }))
    .filter((x) => x.text.length > 0)
    .sort((a, b) => a.t - b.t);

  if (withText.length === 0) return "";
  return withText[withText.length - 1].text;
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
    STEP 3: WAIT ONCE, THEN FETCH MESSAGES ONCE
    ----------------------------------------
    */

    await sleep(BOTPRESS_REPLY_WAIT_MS);

    const messages = await getMessages(userKey, conversationId);
    const botMessage = Array.isArray(messages)
      ? latestBotTextReply(messages, endUserId) || "No response"
      : "No response";

    if (botMessage !== "No response") {
      console.log("Bot reply (preview):", botMessage.slice(0, 120) + (botMessage.length > 120 ? "…" : ""));
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