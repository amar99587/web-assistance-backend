// const FormData = require("form-data");
const express = require("express");
// const multer = require("multer");
const axios = require("axios");
const cors = require("cors");
const app = express();
const port = 7100;

app.use(cors());
app.use(express.json({ limit: "5mb" }));

// const storage = multer.memoryStorage();
// const upload = multer({ storage });
// const form = new FormData();

const GeminiConfig = {
  model: "gemini-2.0-flash:generateContent",
  // apiKey: "AIzaSyBrEof9EX0aRfeWSogMoQw5XvZQI_ZK-mU",
  apiUrl: "https://generativelanguage.googleapis.com/v1beta/models/",
  payload: pageInfo => ({
    system_instruction: {
      role: "system",
      parts: [
        {  text: "You are Web Assistant expert that provide answers and guidance about using a website."  },
        {  text: "website information: " + JSON.stringify(pageInfo)  },
        {  text: "Be friendly, brief and direct, use as few words as possible to deliver a good response."  },
        {  text: "For actions, provide short step-by-step instructions."  },
        {  text: "If you need more information about the page, ask to provide an image about the webpage."  },
        {  text: "You can help about external websites, but for more advanced help just tell to go to that website and continue there to get better results."  },
      ]
    },
    generationConfig: {
      temperature: 0.7, // Controls randomness (0-1)
      maxOutputTokens: 200, // Limits response length
      responseMimeType: "text/plain" // Ensures plain text (or use "application/json" for JSON)
    }
  })
};

// const ElevenLabsConfig = {
//   url: "https://api.elevenlabs.io/v1",
//   // apiKey: "sk_f85ec5be71e1984555ad8ed6b1d2126b2da6e6176b4e42db",
//   textToSpeechModel: "eleven_multilingual_v2",
//   speechToTextModel: "scribe_v1",
//   voiceId: "JBFqnCBsd6RMkjVDRZzb",
// };

const isUrl = str => /^https?:\/\//i.test(str);

// class ElevenLabs {
//   constructor({ url, apiKey, voiceId, textToSpeechModel, speechToTextModel }) {
//     this.url = url;
//     this.voiceId = voiceId;
//     this.textToSpeechModel = textToSpeechModel;
//     this.speechToTextModel = speechToTextModel;
//     this.config = {
//       headers: { "xi-api-key": apiKey },
//     };
//   }

//   textToSpeech = async text => {
//     try {
//       const response = await axios.post(
//         this.url + "/text-to-speech/" + this.voiceId + "/stream",
//         { text, model_id: this.textToSpeechModel },
//         { ...this.config, responseType: "stream" }
//       );

//       return response.data;
//     } catch (error) {
//       console.error("Error in textToSpeech:", { 
//         status: error.status,
//         config: error.response.config,
//        });
//       return null;
//     }
//   };

//   speechToText = async audioFile => {
//     try {
//       form.append("model_id", this.speechToTextModel);

//       if (isUrl(audioFile)) {
//         const response = await axios({ url: audioFile, responseType: "stream" });
//         form.append("file", response.data);
//       } 
//       else if (Buffer.isBuffer(audioFile.buffer)) form.append("file", audioFile.buffer, { filename: "audio" });
//       else return { text: "Audio does not exist!" };

//       const response = await axios.post(
//         this.url + "/speech-to-text",
//         form, { ...this.config, headers: { ...this.config.headers, ...form.getHeaders() } }
//       );

//       return response.data;
//     } catch (error) {
//       console.error("Error in speechToText:", error);
//       return null;
//     }
//   };
// };

// const elevenLabsClient = () => new ElevenLabs(ElevenLabsConfig);

const urlToBase64 = async image => {
  if (isUrl(image)) {
    const response = await axios.get(image, { responseType: "arraybuffer" });
    return {
      mime_type: response.headers["content-type"],
      data: Buffer.from(response.data).toString("base64")
    };
  } else {
    const [prefix, base64Data] = image.split(",");
    const mimeType = prefix.match(/:(.+);/)[1]; // Extract "image/png"
    return {
      mime_type: mimeType, // Use "image/png", not "png"
      data: base64Data // Strip the "data:image/png;base64," prefix
    };
  }
};

const chat = async ({ text, image }, messages, pageInfo) => {
  try {
    const url = GeminiConfig.apiUrl + GeminiConfig.model + "?key=" + GeminiConfig.apiKey

    messages = messages?.map(({ role, text }) => ({ role, parts: [{ text }] }));

    const payload = {
      ...GeminiConfig.payload(pageInfo),
      contents: [ ...messages, ({ role: "user", parts: [] }) ]
    };

    const addPart = value => payload.contents[ payload.contents.length - 1 ].parts.push(value);

    if (text) addPart({ text });
    if (image) addPart({ inline_data: await urlToBase64(image) });
    
    const response = await axios.post(url, payload);
    // console.dir({ payload, response: response.data }, { depth: null });
    
    return response.data?.candidates?.[ 0 ]?.content?.parts?.[ 0 ]?.text || "No Response to: " + text;
  } catch (error) {
    console.log(error);
    return null;
  }
};

const verifyApiKeys = async ({ textApiKey }) => {
  const result = { textApiKeyValid: false, message: "" };

  const requests = {
    gemini: {
      url: GeminiConfig.apiUrl + GeminiConfig.model + "?key=" + textApiKey,
      body: {
        contents: [{ role: "user", parts: [{ text: "Test" }] }],
        generationConfig: { maxOutputTokens: 10, responseMimeType: "text/plain" },
      }
    },
    // elevenlabs: {
    //   url: "https://api.elevenlabs.io/v1/models",
    //   config: { headers: { "xi-api-key": voiceApiKey } },
    // },
  };

  try {
    const [ 
      geminiRes, 
      // elevenLabsRes 
    ] = await Promise.all([
      axios.post(requests.gemini.url, requests.gemini.body).catch(error => ({
        error: "Gemini API key verification failed: " + error.response?.data?.error?.message || error.message,
      })),
      // axios.get(requests.elevenlabs.url, requests.elevenlabs.config).catch(error => ({
      //   error: "ElevenLabs API key verification failed: " + error.message,
      // })),
    ]);

    result.textApiKeyValid = geminiRes?.status === 200 && !!geminiRes.data?.candidates?.[0]?.content;
    // result.voiceApiKeyValid = elevenLabsRes?.status === 200; // no voice option yet
    result.message = [
      geminiRes?.error || (!result.textApiKeyValid && "Gemini API key invalid."),
      // elevenLabsRes?.error || (!result.voiceApiKeyValid && "ElevenLabs API key invalid."),
    ].filter(Boolean).join(" - ").trim();
  } catch (error) {
    console.log(error);    
    result.message = "can't verify keys";
  }

  return {
    validation: result.textApiKeyValid,
    textApiKey,
    textApiKeyValid: result.textApiKeyValid,
    // voiceApiKey,
    // voiceApiKeyValid: result.voiceApiKeyValid,
    message: result.message,
  };
};

app.use((req, res, next) => {
  const textApiKey = req.body?.textApiKey || req.headers[ "x-text-api-key" ];
  GeminiConfig.apiKey = textApiKey;
  
  // const voiceApiKey =  req.body?.voiceApiKey || req.headers[ "x-voice-api-key" ];
  // ElevenLabsConfig.apiKey = voiceApiKey;
  
  console.log(
    "\n",
    `-- New request received at ${ new Date().toLocaleTimeString() } --`,
    { 
      method: req.method, 
      endpoint: req.url, 
      page: req.body?.page, 
      text: req.body?.message?.text || req.body?.text, 
      apiKeys: ![ textApiKey ].includes(undefined),
    }, 
    "\n"
  );

  next();
});

app.post("/verifyApiKeys", async (req, res) => {
  const { textApiKey } = req.body;
  const result = await verifyApiKeys({ textApiKey });
  res.send({ success: result.validation, result });
});

app.post("/chat", async (req, res) => {
  const { message, conversation, page } = req.body;
  const result = await chat(message, conversation, page);
  res.send(result);
});

// app.post("/textToSpeech", async (req, res) => {
//   const { text } = req.body;
//   const result = await elevenLabsClient().textToSpeech(text);
//   if (!result) return res.status(500).send("Text-to-speech failed");
//   res.set("Content-Type", "audio/mpeg");
//   result.pipe(res);
// });

// app.post("/speechToText", upload.single("audioFile"), async (req, res) => {
//   if (!req.file && !req.body?.audioFile) res.status(400).send("No file uploaded.");
//   const result = await elevenLabsClient().speechToText(req.file || req.body.audioFile);
//   if (!result) return res.status(500).send("Speech-to-text failed");
//   res.send(result?.text);
// });

// Handle 404
app.use((req, res) => {
  res.status(404).json({ message: "Not Found" });
});

app.listen(port, () => {
  console.log("Server running on port: " + port);
});
