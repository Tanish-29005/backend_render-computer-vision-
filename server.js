const express = require("express");
const multer = require("multer");
const vision = require("@google-cloud/vision");
const { createClient } = require("@supabase/supabase-js");
const { S3Client, ListBucketsCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();

// Initialize before creating Express app for early validation
console.log("Environment Verification:");
console.log("Supabase URL:", process.env.SUPABASE_URL);
console.log("Bucket Name: food-images");

const app = express();
const port = 5000;

// Enhanced CORS configuration
app.use(cors({
    origin: "*",
    methods: ["POST", "GET"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
}));

// Validate environment variables before proceeding
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.S3_ENDPOINT || !process.env.S3_REGION || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY) {
  console.error("❌ Missing required environment variables");
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Initialize S3 client
const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
  forcePathStyle: true,
});

// Initialize Google Vision client
const client = new vision.ImageAnnotatorClient();

// Add bucket verification before starting server
async function initializeServer() {
  try {
    // Verify bucket exists using S3
    const { Buckets } = await s3Client.send(new ListBucketsCommand({}));
    const bucketExists = Buckets.some(b => b.Name === "food-images");

    if (!bucketExists) {
      console.error("❌ Bucket verification failed: Bucket 'food-images' not found");
      console.log("ℹ️ Create the bucket in Supabase Dashboard: Storage → Buckets");
      process.exit(1);
    }

    console.log("✅ Verified bucket exists: food-images");

    // Start server after successful verification
    app.listen(port, () => {
      console.log(`🚀 Server running at http://localhost:${port}`);
    });

  } catch (error) {
    console.error("❌ Server initialization failed:", error);
    process.exit(1);
  }
}

const upload = multer({ storage: multer.memoryStorage() });

// Improved food detection from labels
function detectFoodType(labels, colors) {
  // Food categories with common foods
  const foodCategories = {
    fruits: ["apple", "banana", "orange", "strawberry", "grape", "watermelon", "kiwi", 
             "pineapple", "mango", "peach", "pear", "blueberry", "raspberry", "apricot", 
             "cherry", "lemon", "lime", "plum", "fig", "date", "pomegranate", "coconut"],
    vegetables: ["tomato", "potato", "carrot", "broccoli", "cucumber", "lettuce", "spinach", 
                "pepper", "onion", "garlic", "cauliflower", "cabbage", "eggplant", "peas", 
                "beans", "corn", "asparagus", "celery", "radish", "beet", "turnip", "zucchini"],
    grains: ["rice", "bread", "pasta", "cereal", "oats", "wheat", "quinoa", "barley", "flour",
             "tortilla", "cracker", "bagel", "biscuit", "muffin", "croissant", "pancake"],
    dairy: ["milk", "cheese", "yogurt", "butter", "cream", "ice cream", "sour cream", 
            "cottage cheese", "whipped cream", "custard"],
    proteins: ["chicken", "beef", "pork", "fish", "egg", "tofu", "beans", "nuts", "turkey", 
              "lamb", "shrimp", "salmon", "tuna", "crab", "lobster", "ham", "bacon", "sausage"]
  };

  // Check for specific foods with higher confidence first
  for (const label of labels) {
    const description = label.description.toLowerCase();
    
    // Check if the label directly matches a food
    for (const category in foodCategories) {
      if (foodCategories[category].includes(description) && label.score > 0.7) {
        return {
          name: label.description,
          confidence: label.score,
          category
        };
      }
    }
    
    // Check if the label contains a food name
    for (const category in foodCategories) {
      for (const food of foodCategories[category]) {
        if (description.includes(food) && label.score > 0.65) {
          return {
            name: food.charAt(0).toUpperCase() + food.slice(1),
            confidence: label.score,
            category
          };
        }
      }
    }
  }

  // If no specific food match found with high confidence,
  // look for food categories or general food terms
  const foodKeywords = ["food", "fruit", "vegetable", "produce", "meal", "dish"];
  for (const label of labels) {
    const description = label.description.toLowerCase();
    for (const keyword of foodKeywords) {
      if (description.includes(keyword) && label.score > 0.6) {
        return {
          name: label.description,
          confidence: label.score,
          category: "other"
        };
      }
    }
  }

  // Default return if no food detected
  return {
    name: labels[0]?.description || "Unknown Food",
    confidence: labels[0]?.score || 0,
    category: "unknown"
  };
}

// Significantly enhanced freshness detection algorithm
function estimateFreshness(foodInfo, labels, imageAnalysis) {
  // Start with a neutral base score
  let freshnessScore = 0.5;
  
  // Explicit spoilage and freshness indicators with weights
  const spoilageIndicators = [
    { term: "mold", weight: -0.5 },
    { term: "rotten", weight: -0.5 },
    { term: "spoiled", weight: -0.5 },
    { term: "stale", weight: -0.4 },
    { term: "bad", weight: -0.3 },
    { term: "decay", weight: -0.4 },
    { term: "black spot", weight: -0.25 },
    { term: "bruise", weight: -0.2 },
    { term: "soft spot", weight: -0.25 },
    { term: "discolored", weight: -0.3 },
    { term: "fermented", weight: -0.3 },
    { term: "mushy", weight: -0.25 },
    { term: "slimy", weight: -0.4 },
    { term: "wilted", weight: -0.25 },
    { term: "old", weight: -0.2 },
    { term: "shriveled", weight: -0.3 },
    { term: "wrinkled", weight: -0.2 },
    { term: "dry", weight: -0.2 },
    { term: "overripe", weight: -0.2 }
  ];
  
  const freshnessIndicators = [
    { term: "fresh", weight: 0.2 },
    { term: "ripe", weight: 0.15 },
    { term: "crisp", weight: 0.15 },
    { term: "firm", weight: 0.1 },
    { term: "bright", weight: 0.05 },
    { term: "vibrant", weight: 0.05 },
    { term: "juicy", weight: 0.1 }
  ];

  // Check for explicit spoilage or freshness indicators in labels
  let spoilageFound = false;
  let freshnessFound = false;
  
  for (const label of labels) {
    const description = label.description.toLowerCase();
    
    // Check for spoilage indicators
    for (const indicator of spoilageIndicators) {
      if (description.includes(indicator.term)) {
        freshnessScore += indicator.weight * label.score;
        spoilageFound = true;
      }
    }
    
    // Check for freshness indicators
    for (const indicator of freshnessIndicators) {
      if (description.includes(indicator.term)) {
        freshnessScore += indicator.weight * label.score;
        freshnessFound = true;
      }
    }
  }
  
  // If neither explicit indicators are found, rely more on visual cues and color analysis
  if (!spoilageFound && !freshnessFound) {
    // Analyze colors based on food type
    if (foodInfo.category === "fruits" || foodInfo.category === "vegetables") {
      const colorAnalysis = analyzeColorsForProduce(foodInfo.name.toLowerCase(), imageAnalysis.colors);
      freshnessScore += colorAnalysis.adjustment;
      
      // If we detect very bad color issues, ensure a low score
      if (colorAnalysis.badColorDetected) {
        freshnessScore = Math.min(freshnessScore, 0.3);
      }
    }
  }
  
  // Food-specific freshness indicators
  applyFoodSpecificRules(foodInfo.name.toLowerCase(), labels, imageAnalysis, (adjustment) => {
    freshnessScore += adjustment;
  });
  
  // Always check for text indicators that might be missed in other steps
  const textIndicators = checkTextDescriptions(labels);
  freshnessScore += textIndicators.adjustment;
  
  if (textIndicators.isSpoiled) {
    freshnessScore = Math.min(freshnessScore, 0.3); // Cap at low value if spoilage text found
  }
  
  // Ensure score stays within bounds
  return Math.max(0.1, Math.min(1.0, freshnessScore));
}

// Helper function for color analysis
function analyzeColorsForProduce(foodName, colors) {
  let adjustment = 0;
  let badColorDetected = false;
  
  // Get dominant colors (top 3)
  const dominantColors = colors.slice(0, 3);
  
  // Analyze based on food type
  if (foodName.includes("apple")) {
    // For apples, check for brown colors which indicate spoilage
    for (const colorData of dominantColors) {
      const color = colorData.color;
      const r = color.red || 0;
      const g = color.green || 0;
      const b = color.blue || 0;
      
      // Detect brown colors (high red, medium green, low blue)
      if (r > 150 && g > 70 && g < 120 && b < 80) {
        adjustment -= 0.3 * colorData.score; // Weight by color prominence
        badColorDetected = true;
      }
      
      // Detect black/very dark colors which might indicate rot
      if (r < 80 && g < 80 && b < 80) {
        adjustment -= 0.4 * colorData.score;
        badColorDetected = true;
      }
      
      // Good colors for apples (red or green)
      if ((r > 150 && g < 100 && b < 100) || (g > 150 && r < 120 && b < 120)) {
        adjustment += 0.2 * colorData.score;
      }
    }
  } else if (foodName.includes("banana")) {
    // For bananas, yellow is good, brown spots are okay, too much brown is bad
    let brownishPixels = 0;
    
    for (const colorData of dominantColors) {
      const color = colorData.color;
      const r = color.red || 0;
      const g = color.green || 0;
      const b = color.blue || 0;
      
      // Detect bright yellow (good)
      if (r > 200 && g > 180 && b < 100) {
        adjustment += 0.2 * colorData.score;
      }
      
      // Detect brown (overripe)
      if (r > 120 && g > 80 && g < 120 && b < 80) {
        brownishPixels += colorData.pixelFraction;
      }
    }
    
    // Too much brown is bad
    if (brownishPixels > 0.5) {
      adjustment -= 0.3;
      badColorDetected = true;
    }
  }
  // Add more specific food color analysis as needed
  
  return { adjustment, badColorDetected };
}

// Helper function for food-specific rules
function applyFoodSpecificRules(foodName, labels, imageAnalysis, adjustCallback) {
  if (foodName.includes("apple")) {
    // Check for shiny surface (good indicator for apples)
    for (const label of labels) {
      if (label.description.toLowerCase().includes("shiny") && label.score > 0.6) {
        adjustCallback(0.15);
      }
      
      // Keywords that indicate apple spoilage
      if (label.description.toLowerCase().includes("bruised") && label.score > 0.6) {
        adjustCallback(-0.25);
      }
      
      if (label.description.toLowerCase().includes("mealy") && label.score > 0.6) {
        adjustCallback(-0.4);
      }
      
      // Brown spots are bad for apples
      if ((label.description.toLowerCase().includes("brown") || 
           label.description.toLowerCase().includes("spot")) && 
          label.score > 0.6) {
        adjustCallback(-0.3);
      }
    }
  } else if (foodName.includes("banana")) {
    // Check for banana-specific indicators
    for (const label of labels) {
      // Green bananas are underripe but fresh
      if (label.description.toLowerCase().includes("green") && label.score > 0.7) {
        adjustCallback(0.2);
      }
      
      // Black bananas are overripe
      if (label.description.toLowerCase().includes("black") && label.score > 0.7) {
        adjustCallback(-0.3);
      }
    }
  }
  // Add more food-specific rules
}

// Helper function to check for spoilage descriptions in text
function checkTextDescriptions(labels) {
  let adjustment = 0;
  let isSpoiled = false;
  
  const spoilageTerms = [
    "rotten", "spoiled", "moldy", "decayed", "bad", "stale", "inedible",
    "overripe", "expired", "off", "sour", "fermented", "decomposed"
  ];
  
  for (const label of labels) {
    const description = label.description.toLowerCase();
    
    for (const term of spoilageTerms) {
      if (description.includes(term)) {
        adjustment -= 0.3 * label.score;
        isSpoiled = true;
      }
    }
  }
  
  return { adjustment, isSpoiled };
}

// Improved expiry estimation
function estimateExpiry(foodInfo, freshnessScore) {
  // Baseline expiry days by category (when at 100% freshness)
  const baseExpiryByCategory = {
    fruits: 7,
    vegetables: 5,
    grains: 90,
    dairy: 7,
    proteins: 3,
    unknown: 4,
    other: 4
  };
  
  // Food-specific overrides
  const specificFoodExpiry = {
    "banana": 5,
    "strawberry": 3,
    "bread": 6,
    "milk": 7,
    "yogurt": 10,
    "chicken": 2,
    "fish": 1,
    "lettuce": 4,
    "spinach": 3,
    "avocado": 3,
    "tomato": 5,
    "apple": 14,
    "orange": 10,
    "carrot": 21,
    "potato": 28,
    "onion": 30,
    "garlic": 90,
    "rice": 365,
    "pasta": 365,
    "egg": 21
  };
  
  // Get base expiry days
  let baseExpiry = baseExpiryByCategory[foodInfo.category] || 4;
  
  // Override with specific food values if available
  for (const [food, days] of Object.entries(specificFoodExpiry)) {
    if (foodInfo.name.toLowerCase().includes(food)) {
      baseExpiry = days;
      break;
    }
  }
  
  // Use exponential rather than linear scale to better reflect reality
  // Very low freshness scores get dramatically reduced expiry times
  let expiryRatio;
  if (freshnessScore < 0.3) {
    expiryRatio = freshnessScore * 0.5; // Very short shelf life
  } else if (freshnessScore < 0.6) {
    expiryRatio = 0.15 + (freshnessScore - 0.3) * 0.8; // Medium shelf life
  } else {
    expiryRatio = 0.39 + (freshnessScore - 0.6) * 1.01; // Close to full shelf life
  }
  
  // Calculate adjusted expiry in days
  let adjustedExpiry = Math.round(baseExpiry * expiryRatio);
  
  // If the food is almost spoiled (very low freshness score)
  if (freshnessScore < 0.2) {
    return "Already spoiled or unsafe to consume";
  } else if (freshnessScore < 0.4) {
    return `Consume immediately${adjustedExpiry === 0 ? '' : ` or within ${adjustedExpiry} day${adjustedExpiry !== 1 ? 's' : ''}`}`;
  } else if (freshnessScore < 0.6) {
    return `Use within ${adjustedExpiry} day${adjustedExpiry !== 1 ? 's' : ''}`;
  } else if (freshnessScore < 0.8) {
    return `Good for about ${adjustedExpiry} day${adjustedExpiry !== 1 ? 's' : ''}`;
  } else {
    return `Fresh for approximately ${adjustedExpiry} day${adjustedExpiry !== 1 ? 's' : ''}`;
  }
}

// Upload Image to Supabase Storage
async function uploadImageToSupabase(imageBuffer, fileName) {
  try {
    console.log(`📤 Attempting upload to bucket 'food-images' as ${fileName}`);

    const params = {
      Bucket: "food-images",
      Key: fileName,
      Body: imageBuffer,
      ContentType: "image/jpeg",
    };

    await s3Client.send(new PutObjectCommand(params));

    console.log("✅ Upload successful:", fileName);
    return `${process.env.SUPABASE_URL}/storage/v1/object/public/food-images/${fileName}`;
  } catch (error) {
    console.error("❌ Upload error:", error);
    return null;
  }
}

// API Route: Upload & Analyze Image
app.post("/analyze", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    console.log("📨 Received analysis request");

    // Upload to Supabase
    const fileName = `food_${Date.now()}.jpg`;
    const imageUrl = await uploadImageToSupabase(req.file.buffer, fileName);

    if (!imageUrl) {
      return res.status(500).json({ error: "Failed to upload image" });
    }

    // Google Vision API - Use multiple features for better analysis
    const features = [
      { type: 'LABEL_DETECTION', maxResults: 20 },
      { type: 'IMAGE_PROPERTIES' },
      { type: 'TEXT_DETECTION' }
    ];

    const request = {
      image: { content: req.file.buffer },
      features: features
    };

    // Use annotateImage instead of annotate
    const [result] = await client.annotateImage(request);

    // Extract data from response
    const labels = result.labelAnnotations || [];
    const colors = result.imagePropertiesAnnotation?.dominantColors?.colors || [];
    const textAnnotations = result.textAnnotations || [];

    // Add text data to labels for more comprehensive analysis
    if (textAnnotations.length > 0) {
      const text = textAnnotations[0].description;
      const words = text.split(/\s+/);

      words.forEach(word => {
        if (word.length > 2) { // Skip very short words
          labels.push({
            description: word,
            score: 0.8, // Assume text detected with high confidence
            topicality: 0.8
          });
        }
      });
    }

    const imageAnalysis = {
      colors: colors.map(c => ({
        color: c.color,
        score: c.score,
        pixelFraction: c.pixelFraction
      })),
      hasText: textAnnotations.length > 0
    };

    // Detect food type with confidence
    const foodInfo = detectFoodType(labels, colors);

    // Calculate freshness score with enhanced algorithm
    const freshnessScore = estimateFreshness(foodInfo, labels, imageAnalysis);

    // Estimate expiry
    const estimatedExpiry = estimateExpiry(foodInfo, freshnessScore);

    // Add debug information for development
    const debugInfo = {
      topLabels: labels.slice(0, 10).map(l => ({ description: l.description, score: l.score })),
      dominantColors: colors.slice(0, 3).map(c => ({
        rgb: `R:${c.color.red}, G:${c.color.green}, B:${c.color.blue}`,
        score: c.score,
        pixelFraction: c.pixelFraction
      })),
      textFound: textAnnotations.length > 0 ? textAnnotations[0].description : "None"
    };

    // Save result to Supabase DB
    const { data, error } = await supabase.from("food_freshness").insert([
      {
        food_name: foodInfo.name,
        food_category: foodInfo.category,
        confidence: foodInfo.confidence,
        freshness_score: freshnessScore,
        estimated_expiry: estimatedExpiry,
        image_url: imageUrl,
        labels: labels.map(l => ({ description: l.description, score: l.score })),
        analysis_data: debugInfo
      }
    ]);

    if (error) {
      console.error("❌ Error inserting data:", error);
      return res.status(500).json({ error: "Failed to save analysis" });
    }

    res.json({
      foodName: foodInfo.name,
      category: foodInfo.category,
      confidence: Math.round(foodInfo.confidence * 100) / 100,
      freshnessScore: Math.round(freshnessScore * 100) / 100,
      estimatedExpiry,
      imageUrl,
      topLabels: labels.slice(0, 5).map(l => ({ description: l.description, score: Math.round(l.score * 100) / 100 })),
      debug: debugInfo // Include in development, remove in production
    });

  } catch (error) {
    console.error("❌ Internal Server Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Test Endpoint for Bucket Connectivity
app.post("/test-upload", async (req, res) => {
  try {
    console.log("🧪 Running bucket connectivity test");
    const testContent = Buffer.from("Integration test - delete me");

    const params = {
      Bucket: "food-images",
      Key: "connection-test.txt",
      Body: testContent,
    };

    await s3Client.send(new PutObjectCommand(params));

    console.log("✅ Bucket connectivity verified");
    res.json({ status: "success", message: "Bucket connection working" });

  } catch (error) {
    console.error("❌ Bucket test failed:", error);
    res.status(500).json({ status: "error", error: error.message });
  }
});

// Initialize the server after all setup
initializeServer();