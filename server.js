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
SESSION STORAGE
----------------------------------------
*/
const sessions = {};

/*
----------------------------------------
HELPERS
----------------------------------------
*/

async function createUser() {
  const res = await fetch(`${BASE_URL}/users`, {
    method: "POST",
  });
  const data = await res.json();
  return data.key; // x-user-key
}

async function createConversation(userKey) {
  const res = await fetch(`${BASE_URL}/conversations`, {
    method: "POST",
    headers: {
      "x-user-key": userKey,
    },
  });
  const data = await res.json();
  return data.id;
}

async function sendMessage(userKey, conversationId, text) {
  await fetch(`${BASE_URL}/messages`, {
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
  const data = await res.json();
  console.log("Botpress messages raw:", JSON.stringify(data, null, 2));
  return data.messages || data;
}

/*
----------------------------------------
HEALTH CHECK
----------------------------------------
*/
app.get("/", (req, res) => {
  res.send("HGS Vision API running (Chat API proper)");
});

/*
----------------------------------------
MAIN ENDPOINT
----------------------------------------
*/
app.post("/identify", upload.single("image"), async (req, res) => {
  try {
    const sessionId = crypto.randomUUID();

    /*
    ----------------------------------------
    IMAGE → PRODUCT NAME (OPENAI)
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

    const productName = aiRes.output_text;

    fs.unlinkSync(imagePath);

    /*
    ----------------------------------------
    BOTPRESS FLOW
    ----------------------------------------
    */

    // 1. Create user
    const userKey = await createUser();

    // 2. Create conversation
    const conversationId = await createConversation(userKey);

    // 3. Send product name
    await sendMessage(userKey, conversationId, productName);

    // 4. Wait briefly for bot to respond
    await new Promise((r) => setTimeout(r, 1500));

    // 5. Get messages
    const messages = await getMessages(userKey, conversationId);

    // Extract last bot message
    let botMessage = "No response";

if (Array.isArray(messages)) {
  const outgoing = messages.filter(
    (m) => m.direction === "outgoing"
  );

  if (outgoing.length > 0) {
    botMessage =
      outgoing[outgoing.length - 1]?.payload?.text || "No response";
  }
} else {
  console.log("Unexpected messages format:", messages);
}

    /*
    ----------------------------------------
    RESPONSE
    ----------------------------------------
    */
    res.json({
      product: productName,
      botpress: botMessage,
      conversationId,
      status: "complete",
    });
  } catch (err) {
    console.error(err);
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