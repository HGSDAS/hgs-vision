import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import multer from "multer";
import fs from "fs";

dotenv.config();

const app = express();
app.use(cors());

const upload = multer({ dest: "uploads/" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Health check
app.get("/", (req, res) => {
  res.send("HGS Vision API running");
});

//botpress response
app.post("/botpress-response", express.json(), (req, res) => {
  console.log("Botpress response received:", req.body);

  // This is where you will eventually forward to app or store result
  res.sendStatus(200);
});

// Product identification endpoint
app.post("/identify", upload.single("image"), async (req, res) => {
  try {
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
    //fs.unlinkSync(imagePath);
/*
    res.json({
      result: response.output_text,
    });
	
	*/
	const botpressResponse = await fetch(
  "https://webhook.botpress.cloud/acdfafc0-d162-44cd-a730-86dc6ce12b47",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      product: productName
    })
  }
);
const botpressData = await botpressResponse.json();

res.json({
  result: botpressData
});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Vision processing failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HGS Vision running on port ${PORT}`);
});