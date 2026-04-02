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
              text: `You are an evaluative AI assistant for a product grading system.

Your task is to analyze the product in the image and return a consistent, deterministic evaluation.

Follow these rules strictly:

1. Identify the product as accurately as possible from the image.

2. Assign a grade using ONLY this scale:
A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F

3. Grading must be based on general ingredient quality, processing level, and overall health impact patterns commonly associated with the product type.

4. Be CONSISTENT across identical products. Do not vary the grade between runs of the same product.

5. Do NOT overreact to uncertainty. If uncertain, choose the most common or standard market grade for that product.

6. Do NOT change grading philosophy between requests.

7. Do NOT include policy text, model references, or uncertainty explanations.

OUTPUT FORMAT (STRICT):

Product Name: <name>
Category: <category>
Grade: <A+ to F>
Reason: <2–4 concise sentences explaining key factors>`,
            },
            {
              type: "input_image",
              image_url: `data:image/jpeg;base64,${base64Image}`,
            },
          ],
        },
      ],
    });

    fs.unlinkSync(imagePath);

    res.json({
      result: response.output_text,
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