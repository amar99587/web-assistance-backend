const { ElevenLabsClient } = require("elevenlabs");
const { Readable } = require("stream");
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const cors = require("cors");
const app = express();
const port = 7100;

app.use(cors());
app.use(express.json({ limit: "5mb" }));

const storage = multer.memoryStorage();
const upload = multer({ storage });

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

const ElevenLabsConfig = {
  // apiKey: "sk_f85ec5be71e1984555ad8ed6b1d2126b2da6e6176b4e42db",
  textToSpeechModel: "eleven_multilingual_v2",
  speechToTextModel: "scribe_v1",
  voiceId: "JBFqnCBsd6RMkjVDRZzb",
};

const isUrl = str => /^https?:\/\//i.test(str);

class ElevenLabs {
  constructor({ apiKey, textToSpeechModel, speechToTextModel, voiceId }) {
    this.textToSpeechModel = textToSpeechModel;
    this.speechToTextModel = speechToTextModel;
    this.apiKey = apiKey;
    this.voiceId = voiceId;
    this.client = new ElevenLabsClient({ apiKey });
  };

  textToSpeech = async text => {
    try {
      const audioStream = await this.client.textToSpeech.convertAsStream(
        this.voiceId,
        { text, model_id: this.textToSpeechModel },
        { headers: { "xi-api-key": this.apiKey } }
      );
  
      // option 1: play the streamed audio locally
      // await stream(Readable.from(audioStream));
  
      // option 2: process the audio manually
      // for await (const chunk of audioStream) {
      //   console.log({ chunk });
      // }
  
      return audioStream;
    } catch (error) {
      console.error("Error in textToSpeech:", error);
      return null;
    }
  };

  speechToText = async audioFile => {
    try {
      const audioConfig = {
        model_id: this.speechToTextModel
      };
  
      // if audioFile is not an actual file, it can be an URL //or a file path
      if (isUrl(audioFile)) {
        const response = await axios({ url: audioFile, responseType: "stream" });
        audioConfig.file = response.data;
      }
      else if (Buffer.isBuffer(audioFile.buffer)) audioConfig.file = Readable.from(audioFile.buffer); // Convert buffer to stream
      // else if (fs.existsSync(audioFile)) audioConfig.file = fs.createReadStream(audioFile);
  
      if (!audioConfig.file) return { text: "Audio does not exists !!" };
  
      const response = await this.client.speechToText.convert(audioConfig);
      return response;
    } catch (error) {
      console.error("Error in speechToText:", error);
      return null;
    }
  };
};

let elevenLabsClient;

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

const verifyApiKeys = async ({ textApiKey, voiceApiKey }) => {
  let textApiKeyValid = false;
  let voiceApiKeyValid = false;
  let message = "";

  const config = {
    gemini: {
      url: GeminiConfig.apiUrl + GeminiConfig.model + "?key=" + textApiKey,
      body: {
        contents: [{ role: "user", parts: [{ text: "Test" }] }],
        generationConfig: { maxOutputTokens: 10, responseMimeType: "text/plain" }
      }
    },
    elevenlabs: {
      method: 'get',
      maxBodyLength: Infinity,
      url: 'https://api.elevenlabs.io/v1/models',
      headers: { 
        'Content-Type': 'application/json', 
        'xi-api-key': voiceApiKey
      }
    }
  };

  try {
    const [ textApiKeyResponse, voiceApiKeyResponse ] = await Promise.all([
      axios.post(config.gemini.url, config.gemini.body),
      axios.request(config.elevenlabs)
    ]);

    if (textApiKeyResponse.status === 200 && textApiKeyResponse.data?.candidates?.[0]?.content) textApiKeyValid = true;
    else message += "Gemini API key invalid. ";

    if (voiceApiKeyResponse?.detail?.status != "invalid_api_key") voiceApiKeyValid = true;
    else message += "ElevenLabs API key invalid.";
  } catch (error) {
    message += error.message || "error";
  };

  return { validation: textApiKeyValid && voiceApiKeyValid, textApiKeyValid, textApiKey, voiceApiKeyValid, voiceApiKey, message };
};

app.use((req, res, next) => {
  const textApiKey = req.body?.textApiKey || req.headers[ "x-text-api-key" ];
  GeminiConfig.apiKey = textApiKey;
  
  const voiceApiKey =  req.body?.voiceApiKey || req.headers[ "x-voice-api-key" ];
  if(voiceApiKey) {
    ElevenLabsConfig.apiKey = voiceApiKey;
    elevenLabsClient = new ElevenLabs(ElevenLabsConfig);
  }
  
  console.log(
    "\n",
    `-- New request received at ${ new Date().toLocaleTimeString() } --`,
    { 
      method: req.method, 
      endpoint: req.url, 
      page: req.body?.page || req.headers?.origin, 
      text: req.body?.message?.text || req.body?.text, 
      apiKeys: ![ textApiKey, voiceApiKey ].includes(undefined),
    }, 
    "\n"
  );

  next();
});

app.post("/verifyApiKeys", async (req, res) => {
  const { textApiKey, voiceApiKey } = req.body;
  const result = await verifyApiKeys({ textApiKey, voiceApiKey });
  console.log("API keys verification result: ");
  console.dir(result, { depth: null });
  
  res.send({ success: result.validation, result });
});

app.post("/chat", async (req, res) => {
  const { message, conversation, page } = req.body;
  const result = await chat(message, conversation, page);
  res.send(result);
});

app.post("/textToSpeech", async (req, res) => {
  const { text } = req.body;
  const audioStream = await elevenLabsClient.textToSpeech(text);
  res.set("Content-Type", "audio/mpeg");
  audioStream.pipe(res);
});

app.post("/speechToText", upload.single("audioFile"), async (req, res) => {
  if (!req.file && !req.body?.audioFile) res.status(400).send("No file uploaded.");
  const result = await elevenLabsClient.speechToText(req.file || req.body.audioFile);
  res.send(result?.text);
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ message: "Not Found" });
});

app.listen(port, () => {
  console.log("Server running on port: " + port);
});
