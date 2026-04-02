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
IN-MEMORY STORAGE (replace with Redis later)
----------------------------------------
*/
const pending = {};

/*
----------------------------------------
HEALTH CHECK
----------------------------------------
*/
app.get("/", (req, res) => {
  res.send("HGS Vision API running");
});

/*
----------------------------------------
BOTPRESS CALLBACK (ASYNC RESPONSE)
----------------------------------------
*/
app.post("/botpress-response", (req, res) => {
  const body = req.body;

  console.log("Botpress response received:", body);

  const scanId = body?.scanId || body?.state?.scanId;

  if (!scanId) {
    console.log("Missing scanId in Botpress response");
    return res.sendStatus(200);
  }

  pending[scanId] = {
    status: "done",
    result: body,
    completedAt: Date.now(),
  };

  console.log(`Stored Botpress result for scanId: ${scanId}`);

  res.sendStatus(200);
});

/*
----------------------------------------
APP POLLING ENDPOINT (GET RESULT)
----------------------------------------
*/
app.get("/result/:scanId", (req, res) => {
  const scanId = req.params.scanId;

  const data = pending[scanId];

  if (!data) {
    return res.json({
      status: "not_found",
    });
  }

  return res.json(data);
});

/*
----------------------------------------
PRODUCT IDENTIFICATION + BOTPRESS SEND
----------------------------------------
*/
app.post("/identify", upload.single("image"), async (req, res) => {
  try {
    const scanId = crypto.randomUUID();

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

    /*
    ----------------------------------------
    MARK AS PENDING BEFORE SENDING
    ----------------------------------------
    */
    pending[scanId] = {
      status: "processing",
      product: productName,
      createdAt: Date.now(),
    };

    /*
    ----------------------------------------
    SEND TO BOTPRESS (WITH scanId)
    ----------------------------------------
    */
    const botpressResponse = await fetch(
      "https://webhook.botpress.cloud/acdfafc0-d162-44cd-a730-86dc6ce12b47",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scanId,
          product: productName,
        }),
      }
    );

    const botpressData = await botpressResponse.json().catch(() => ({}));

    fs.unlinkSync(imagePath);

    /*
    ----------------------------------------
    RETURN IMMEDIATE RESPONSE TO APP
    ----------------------------------------
    */
    res.json({
      scanId,
      product: productName,
      botpress: botpressData,
      status: "processing",
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