
import { GoogleGenAI, Type } from "@google/genai";

export const analyzeCropImage = async (base64Image: string, language: 'en' | 'kn') => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = language === 'kn' 
      ? "ರೈತರಿಗೆ ಅನುಕೂಲವಾಗುವಂತೆ ಈ ಬೆಳೆ ಚಿತ್ರವನ್ನು ವಿಶ್ಲೇಷಿಸಿ. ಯಾವುದಾದರೂ ಕೀಟ ಅಥವಾ ರೋಗವಿದೆಯೇ ಎಂದು ತಿಳಿಸಿ ಮತ್ತು ಪರಿಹಾರ ಸೂಚಿಸಿ. ಉತ್ತರ ಕನ್ನಡದಲ್ಲಿರಲಿ."
      : "Analyze this crop image for pests or diseases. Suggest treatments. Keep the advice practical for a farmer in Mandya, Karnataka.";

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { data: base64Image, mimeType: 'image/jpeg' } },
          { text: prompt }
        ]
      }
    });

    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Could not analyze. Please check your connection.";
  }
};

export const getMarketAdvice = async (crop: string, language: 'en' | 'kn') => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Provide selling advice for ${crop} in Mandya district today. Focus on price trends and recommended Mandis. Language: ${language === 'kn' ? 'Kannada' : 'English'}`,
      config: {
          thinkingConfig: { thinkingBudget: 0 }
      }
    });
    return response.text;
  } catch (error) {
    return "Error getting advice.";
  }
};

export const getSoilRecommendation = async (n: number, p: number, k: number, ph: number, language: 'en' | 'kn') => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Soil Test Results for Mandya region: N=${n}, P=${p}, K=${k}, pH=${ph}. Suggest best fertilizers and quantity. Language: ${language === 'kn' ? 'Kannada' : 'English'}`,
        });
        return response.text;
    } catch (err) {
        return "Failed to get recommendations.";
    }
}
