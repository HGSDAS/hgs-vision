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

/*
----------------------------------------
SESSION STORAGE (simple in-memory)
----------------------------------------
*/
const sessions = {};

/*
----------------------------------------
HEALTH CHECK
----------------------------------------
*/
app.get("/", (req, res) => {
  res.send("HGS Vision API running (Chat API mode)");
});

/*
----------------------------------------
PRODUCT IDENTIFICATION (VISION)
----------------------------------------
*/
app.post("/identify", upload.single("image"), async (req, res) => {

  try {
    const conversationId =
      req.body?.conversationId || crypto.randomUUID();

    const imagePath = req.file.path;
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString("base64");

    const response = await openai.responses.create({
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

    const productName = response.output_text;

    fs.unlinkSync(imagePath);

    /*
    ----------------------------------------
    STORE SESSION
    ----------------------------------------
    */
    sessions[conversationId] = {
      product: productName,
      status: "sent_to_botpress",
      createdAt: Date.now(),
    };

    /*
    ----------------------------------------
    SEND TO BOTPRESS CHAT API
    ----------------------------------------
    */
    const botpressResponse = await fetch(
      "https://webhook.botpress.cloud/d545cfd3-c850-4a89-8dc4-3ab4b4fc85f8",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId,
          payload: {
            product: productName,
          },
        }),
      }
    );

    const botpressData = await botpressResponse.json().catch(() => ({}));

    /*
    ----------------------------------------
    UPDATE SESSION
    ----------------------------------------
    */
    sessions[conversationId].status = "processing";
    sessions[conversationId].botpressAck = botpressData;

    /*
    ----------------------------------------
    RETURN IMMEDIATELY
    ----------------------------------------
    */
    res.json({
  conversationId,
  product: productName,
  botpress: botpressData,
  status: "complete",
});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Vision processing failed" });
  }
});

/*
----------------------------------------
RESULT CHECK (optional polling)
----------------------------------------
*/
app.get("/session/:conversationId", (req, res) => {
  const session = sessions[req.params.conversationId];

  if (!session) {
    return res.json({ status: "not_found" });
  }

  res.json(session);
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