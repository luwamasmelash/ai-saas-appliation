import OpenAI from "openai";
import { clerkClient } from "@clerk/express";
import sql from "../configs/db.js";
import { fal } from "@fal-ai/client";
import cloudinary from "../configs/cloudinary.js";
import fs from "fs";
import { PDFParse } from "pdf-parse";

fal.config({
  credentials: process.env.FAL_KEY,
});

const AI = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

// ======================================================
// 1. GENERATE ARTICLE - GEMINI
// ======================================================

export const generateArticle = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt, length } = req.body;

    const plan = req.plan;
    const free_usage = req.free_usage;

    if (plan !== "premium" && free_usage >= 10) {
      return res.json({
        success: false,
        message: "Limit reached. Upgrade to continue.",
      });
    }

    const response = await AI.chat.completions.create({
      model: "gemini-3.6-flash",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: Number(length),
    });

    const content = response.choices[0].message.content;

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, ${prompt}, ${content}, 'article')
    `;

    if (plan !== "premium") {
      await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: {
          free_usage: free_usage + 1,
        },
      });
    }

    res.json({
      success: true,
      content,
    });
  } catch (error) {
    console.log("Generate article error:", error.message);

    res.json({
      success: false,
      message: error.message,
    });
  }
};

// ======================================================
// 2. GENERATE BLOG TITLE - GEMINI
// ======================================================

export const generateBlogTitle = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt } = req.body;

    const plan = req.plan;
    const free_usage = req.free_usage;

    if (plan !== "premium" && free_usage >= 10) {
      return res.json({
        success: false,
        message: "Limit reached. Upgrade to continue.",
      });
    }

    if (!prompt || prompt.trim() === "") {
      return res.json({
        success: false,
        message: "Prompt is required.",
      });
    }

    const response = await AI.chat.completions.create({
      model: "gemini-3.6-flash",

      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],

      temperature: 0.7,
    });

    const content = response.choices?.[0]?.message?.content;

    if (!content) {
      return res.json({
        success: false,
        message: "AI did not return any content.",
      });
    }

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, ${prompt}, ${content}, 'blog-title')
    `;

    if (plan !== "premium") {
      await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: {
          free_usage: free_usage + 1,
        },
      });
    }

    res.json({
      success: true,
      content,
    });
  } catch (error) {
    console.log("Generate blog title error:", error.message);

    res.json({
      success: false,
      message: error.message,
    });
  }
};

// ======================================================
// 3. GENERATE IMAGE - FAL.AI
// ======================================================

export const generateImage = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt, publish } = req.body;

    const plan = req.plan;

    if (plan !== "premium") {
      return res.json({
        success: false,
        message: "This feature is only available for premium subscription.",
      });
    }

    if (!prompt || prompt.trim() === "") {
      return res.json({
        success: false,
        message: "Prompt is required.",
      });
    }

    const result = await fal.subscribe("fal-ai/flux/schnell", {
      input: {
        prompt,
      },
    });

    const imageUrl = result.data?.images?.[0]?.url;

    if (!imageUrl) {
      return res.json({
        success: false,
        message: "Image generation failed.",
      });
    }

    // Store generated image in Cloudinary
    const uploadResult = await cloudinary.uploader.upload(imageUrl);

    const secure_url = uploadResult.secure_url;

    await sql`
      INSERT INTO creations (
        user_id,
        prompt,
        content,
        type,
        publish
      )
      VALUES (
        ${userId},
        ${prompt},
        ${secure_url},
        'image',
        ${publish ?? false}
      )
    `;

    res.json({
      success: true,
      content: secure_url,
    });
  } catch (error) {
    console.log("Generate image error:", error.message);

    res.json({
      success: false,
      message: error.message,
    });
  }
};

// ======================================================
// 4. REMOVE IMAGE BACKGROUND - FAL.AI
// ======================================================

export const removeImageBackground = async (req, res) => {
  try {
    const { userId } = req.auth();
    const file = req.file;
    const plan = req.plan;

    if (plan !== "premium") {
      return res.json({
        success: false,
        message: "This feature is only available for premium subscriptions.",
      });
    }

    if (!file) {
      return res.json({
        success: false,
        message: "Please upload an image.",
      });
    }

    // Upload original image to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(file.path);

    const imageUrl = uploadResult.secure_url;

    // Remove background with fal.ai
    const result = await fal.subscribe("fal-ai/birefnet", {
      input: {
        image_url: imageUrl,
      },
    });

    const processedImageUrl = result.data?.image?.url;

    if (!processedImageUrl) {
      return res.json({
        success: false,
        message: "Background removal failed.",
      });
    }

    // Store processed image in Cloudinary
    const finalUpload = await cloudinary.uploader.upload(processedImageUrl);

    const secure_url = finalUpload.secure_url;

    await sql`
      INSERT INTO creations (
        user_id,
        prompt,
        content,
        type
      )
      VALUES (
        ${userId},
        'Remove background from image',
        ${secure_url},
        'image'
      )
    `;

    res.json({
      success: true,
      content: secure_url,
    });
  } catch (error) {
    console.log("Remove background error:", error.message);

    res.json({
      success: false,
      message: error.message,
    });
  }
};

// ======================================================
// 5. REMOVE IMAGE OBJECT - FAL.AI
// ======================================================

export const removeImageObject = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { object } = req.body;
    const file = req.file;
    const plan = req.plan;

    if (plan !== "premium") {
      return res.json({
        success: false,
        message: "This feature is only available for premium subscriptions.",
      });
    }

    if (!file) {
      return res.json({
        success: false,
        message: "Please upload an image.",
      });
    }

    if (!object || object.trim() === "") {
      return res.json({
        success: false,
        message: "Please specify the object to remove.",
      });
    }

    // Upload original image to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(file.path);

    const imageUrl = uploadResult.secure_url;

    // Submit object removal request to FAL
    const { request_id } = await fal.queue.submit(
      "fal-ai/object-removal",
      {
        input: {
          image_url: imageUrl,
          prompt: object.trim(),
        },
      }
    );

    console.log("FAL REQUEST ID:", request_id);

    // Wait for the result
    let result;

    while (true) {
      const status = await fal.queue.status(
        "fal-ai/object-removal",
        {
          requestId: request_id,
          logs: false,
        }
      );

      console.log("FAL STATUS:", status.status);

      if (status.status === "COMPLETED") {
        result = await fal.queue.result(
          "fal-ai/object-removal",
          {
            requestId: request_id,
          }
        );

        break;
      }

      if (status.status === "FAILED") {
        return res.json({
          success: false,
          message: "FAL image processing failed.",
        });
      }

      // Wait 2 seconds before checking again
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    console.log(
      "FAL RESULT:",
      JSON.stringify(result, null, 2)
    );

    const processedImageUrl =
      result.data?.images?.[0]?.url;

    if (!processedImageUrl) {
      return res.json({
        success: false,
        message: "Object removal failed. No image was returned.",
      });
    }

    // Upload processed image to Cloudinary
    const finalUpload = await cloudinary.uploader.upload(
      processedImageUrl
    );

    const secure_url = finalUpload.secure_url;

    // Save to database
    await sql`
      INSERT INTO creations (
        user_id,
        prompt,
        content,
        type
      )
      VALUES (
        ${userId},
        ${`Removed ${object.trim()} from image`},
        ${secure_url},
        'image'
      )
    `;

    res.json({
      success: true,
      content: secure_url,
    });

  } catch (error) {
    console.log("Remove image object error:", error);

    res.json({
      success: false,
      message:
        error.message ||
        "Something went wrong while removing the object.",
    });
  }
};

// ======================================================
// 6. RESUME REVIEW - FAL.AI
// ======================================================

export const resumeReview = async (req, res) => {
  try {
    const { userId } = req.auth();
    const resume = req.file;
    const plan = req.plan;

    if (plan !== "premium") {
      return res.json({
        success: false,
        message: "This feature is only available for premium subscriptions.",
      });
    }

    if (!resume) {
      return res.json({
        success: false,
        message: "Please upload a resume.",
      });
    }

    if (resume.size > 5 * 1024 * 1024) {
      return res.json({
        success: false,
        message: "Resume file size exceeds allowed size (5MB).",
      });
    }

    // Read PDF
    const dataBuffer = fs.readFileSync(resume.path);

    const parser = new PDFParse({
      data: dataBuffer,
    });

    const pdfData = await parser.getText();

    await parser.destroy();

    if (!pdfData.text || pdfData.text.trim() === "") {
      return res.json({
        success: false,
        message: "Could not extract text from the resume.",
      });
    }

    const prompt = `
Review the following resume and provide constructive feedback.

Analyze:
1. Overall quality
2. Strengths
3. Weaknesses
4. Skills
5. Work experience
6. Education
7. Formatting
8. Areas for improvement
9. Specific recommendations

Resume Content:

${pdfData.text}
`;

    // Use fal.ai text model instead of Gemini
    const result = await fal.subscribe("openrouter/router", {
      input: {
        prompt,
        model: "meta-llama/llama-3.3-70b-instruct",
      },
    });

    const content =
      result.data?.output || result.data?.text || result.data?.response;

    if (!content) {
      return res.json({
        success: false,
        message: "Failed to generate resume review.",
      });
    }

    await sql`
      INSERT INTO creations (
        user_id,
        prompt,
        content,
        type
      )
      VALUES (
        ${userId},
        'Review the uploaded resume',
        ${content},
        'resume-review'
      )
    `;

    res.json({
      success: true,
      content,
    });
  } catch (error) {
    console.log("Resume review error:", error.message);

    res.json({
      success: false,
      message: error.message,
    });
  }
};
