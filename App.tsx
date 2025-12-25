
import React, { useState, useRef, useEffect } from 'react';
import Layout from './components/Layout';
import { Language, MarketPrice, MarketplaceItem } from './types';
import { translations } from './translations';
import { MOCK_PRICES, MOCK_MARKETPLACE, MOCK_EQUIPMENT, COLORS } from './constants';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { analyzeCropImage, getSoilRecommendation } from './services/geminiService';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';

// --- Audio Utility Functions ---
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function createBlob(data: Float32Array): { data: string; mimeType: string } {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

const App: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [lang, setLang] = useState<Language>('en');
  const [activeTab, setActiveTab] = useState('home');
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState(false);
  
  // Marketplace State
  const [marketplaceItems, setMarketplaceItems] = useState<MarketplaceItem[]>(MOCK_MARKETPLACE);
  const [isPostingAd, setIsPostingAd] = useState(false);
  const [newAd, setNewAd] = useState({
    crop: '',
    quantity: '',
    price: '',
    location: ''
  });

  const t = translations[lang];

  // Voice Session Refs
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.length === 10 && password.length >= 4) {
      setIsLoggedIn(true);
      setAuthError(false);
    } else {
      setAuthError(true);
    }
  };

  const handleGoogleLogin = () => {
    setIsLoggedIn(true);
  };

  const handlePostAd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAd.crop || !newAd.quantity || !newAd.price || !newAd.location) return;

    const ad: MarketplaceItem = {
      id: Math.random().toString(36).substr(2, 9),
      farmerName: lang === 'en' ? "Me (Farmer)" : "ನಾನು (ರೈತ)",
      crop: newAd.crop,
      quantity: newAd.quantity,
      price: newAd.price,
      location: newAd.location,
      image: `https://picsum.photos/seed/${newAd.crop}/400/300`
    };

    setMarketplaceItems([ad, ...marketplaceItems]);
    setNewAd({ crop: '', quantity: '', price: '', location: '' });
    setIsPostingAd(false);
    alert(t.adSuccess);
  };

  const startVoiceSession = async () => {
    try {
      setIsVoiceActive(true);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      audioContextInRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextOutRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            const source = audioContextInRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextInRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextInRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && audioContextOutRef.current) {
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContextOutRef.current.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64Audio), audioContextOutRef.current, 24000, 1);
              const source = audioContextOutRef.current.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(audioContextOutRef.current.destination);
              source.onended = () => sourcesRef.current.delete(source);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onclose: () => setIsVoiceActive(false),
          onerror: () => setIsVoiceActive(false)
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: lang === 'kn' ? 'Kore' : 'Zephyr' } }
          },
          systemInstruction: `You are a friendly agriculture assistant for farmers in Mandya, Karnataka called Raitha Bandhu. 
          Help them with crop advice, market prices, and government schemes. 
          Respond in ${lang === 'kn' ? 'Kannada' : 'English'}. Keep answers helpful and practical.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (error) {
      console.error("Voice Error:", error);
      setIsVoiceActive(false);
    }
  };

  const stopVoiceSession = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (audioContextInRef.current) audioContextInRef.current.close();
    if (audioContextOutRef.current) audioContextOutRef.current.close();
    setIsVoiceActive(false);
  };

  // Views
  const renderHome = () => (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="rounded-3xl p-6 text-white overflow-hidden relative shadow-lg earth-gradient">
        <div className="relative z-10">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm opacity-90">Local Region, Karnataka</p>
              <h2 className="text-4xl font-bold mt-1">29°C</h2>
            </div>
            <div className="text-4xl">☀️</div>
          </div>
          <div className="mt-4 p-3 bg-white/20 rounded-xl flex items-center gap-3">
            <span className="bg-white text-green-900 text-xs font-bold px-2 py-1 rounded">ALERT</span>
            <p className="text-xs font-medium">Moderate rain expected soon. Secure your harvest!</p>
          </div>
        </div>
        <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
      </div>

      <section>
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-bold text-lg">{t.currentPrice}</h3>
          <button className="text-xs text-green-700 font-bold" onClick={() => setActiveTab('market')}>{t.viewAll} →</button>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
          {MOCK_PRICES.map((p, i) => (
            <div key={i} className="min-w-[140px] bg-white p-4 rounded-2xl shadow-sm border border-orange-50">
              <p className="text-xs text-gray-500 truncate">{p.crop}</p>
              <p className="text-lg font-bold mt-1">₹{p.price}</p>
              <div className={`text-[10px] mt-2 flex items-center ${p.trend === 'up' ? 'text-green-600' : p.trend === 'down' ? 'text-red-500' : 'text-blue-500'}`}>
                {p.trend === 'up' ? '▲' : p.trend === 'down' ? '▼' : '●'} {p.unit}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4">
        <button onClick={() => setActiveTab('soil')} className="flex flex-col items-center justify-center p-6 bg-white rounded-3xl shadow-sm border border-stone-100">
          <span className="text-3xl mb-2">🌱</span>
          <span className="text-sm font-bold text-center leading-tight">{t.soil}</span>
        </button>
        <button onClick={() => setActiveTab('tools')} className="flex flex-col items-center justify-center p-6 bg-white rounded-3xl shadow-sm border border-stone-100">
          <span className="text-3xl mb-2">🚜</span>
          <span className="text-sm font-bold text-center leading-tight">{t.rent}</span>
        </button>
      </section>

      <div className="bg-[#bc6c25]/10 p-5 rounded-3xl border border-[#bc6c25]/20">
        <h4 className="font-bold mb-2 flex items-center gap-2">
          <span>💡</span> {t.suggestedCrops}
        </h4>
        <div className="space-y-2">
            {[t.sugarcane, t.paddy, t.ragi].map((crop, i) => (
                <div key={i} className="flex justify-between items-center text-sm p-2 bg-white/50 rounded-lg">
                    <span>{crop}</span>
                    <span className="text-green-700 font-bold">High Profit</span>
                </div>
            ))}
        </div>
      </div>
    </div>
  );

  const renderMarket = () => (
    <div className="space-y-6 animate-in slide-in-from-right duration-300">
      <h2 className="text-2xl font-bold mb-4">{t.market}</h2>
      <div className="bg-white p-4 rounded-3xl shadow-sm h-64 border">
        <h3 className="text-sm font-bold mb-4">Crop Price Trend (District APMC)</h3>
        <ResponsiveContainer width="100%" height="80%">
          <LineChart data={[
            { month: 'Jan', price: 2800 },
            { month: 'Feb', price: 2900 },
            { month: 'Mar', price: 3050 },
            { month: 'Apr', price: 3150 },
          ]}>
            <XAxis dataKey="month" stroke="#888" fontSize={12} />
            <YAxis hide />
            <Tooltip />
            <Line type="monotone" dataKey="price" stroke="#2d6a4f" strokeWidth={3} dot={{ fill: '#2d6a4f' }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-3">
        {MOCK_PRICES.map((p, i) => (
          <div key={i} className="bg-white p-4 rounded-2xl flex justify-between items-center shadow-sm">
            <div>
              <p className="font-bold text-lg">{p.crop}</p>
              <p className="text-xs text-gray-500">{p.mandi} Market</p>
            </div>
            <div className="text-right">
              <p className="font-bold text-xl text-green-800">₹{p.price}</p>
              <p className="text-[10px] text-gray-400">per {p.unit}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderMarketplace = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">{t.sell}</h2>
        <button 
          onClick={() => setIsPostingAd(true)}
          className="bg-green-700 text-white px-4 py-2 rounded-full text-sm font-bold active:scale-95 transition-transform"
        >
          + {t.postAd}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4">
        {marketplaceItems.map((item) => (
          <div key={item.id} className="bg-white rounded-3xl overflow-hidden shadow-sm border border-stone-100 animate-in slide-in-from-bottom duration-300">
            <img src={item.image} className="w-full h-40 object-cover" alt={item.crop} />
            <div className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-lg">{item.crop}</h3>
                  <p className="text-xs text-gray-500">By {item.farmerName} • {item.location}</p>
                </div>
                <span className="bg-orange-100 text-orange-800 text-xs px-2 py-1 rounded font-bold">{item.quantity}</span>
              </div>
              <div className="mt-4 flex justify-between items-center">
                <span className="text-xl font-bold text-green-800">{item.price}</span>
                <button className="bg-[#bc6c25] text-white px-4 py-2 rounded-xl text-sm font-bold">Contact</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Post Ad Form Overlay */}
      {isPostingAd && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] flex items-end justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-t-[40px] p-8 pb-12 shadow-2xl animate-in slide-in-from-bottom duration-300">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-green-900">{t.postAd}</h2>
              <button onClick={() => setIsPostingAd(false)} className="text-gray-400 text-2xl">×</button>
            </div>
            <form onSubmit={handlePostAd} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 uppercase">{t.cropName}</label>
                <input 
                  type="text" 
                  required
                  value={newAd.crop}
                  onChange={e => setNewAd({...newAd, crop: e.target.value})}
                  className="w-full bg-stone-50 border border-stone-200 p-3 rounded-2xl outline-none focus:border-green-600"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 uppercase">{t.quantity}</label>
                <input 
                  type="text" 
                  required
                  value={newAd.quantity}
                  onChange={e => setNewAd({...newAd, quantity: e.target.value})}
                  className="w-full bg-stone-50 border border-stone-200 p-3 rounded-2xl outline-none focus:border-green-600"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500 uppercase">{t.price}</label>
                  <input 
                    type="text" 
                    required
                    value={newAd.price}
                    onChange={e => setNewAd({...newAd, price: e.target.value})}
                    className="w-full bg-stone-50 border border-stone-200 p-3 rounded-2xl outline-none focus:border-green-600"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500 uppercase">{t.location}</label>
                  <input 
                    type="text" 
                    required
                    value={newAd.location}
                    onChange={e => setNewAd({...newAd, location: e.target.value})}
                    className="w-full bg-stone-50 border border-stone-200 p-3 rounded-2xl outline-none focus:border-green-600"
                  />
                </div>
              </div>
              <div className="pt-4 flex gap-4">
                <button 
                  type="button"
                  onClick={() => setIsPostingAd(false)}
                  className="flex-1 bg-gray-100 text-gray-600 py-4 rounded-2xl font-bold"
                >
                  {t.cancel}
                </button>
                <button 
                  type="submit"
                  className="flex-2 bg-green-800 text-white py-4 rounded-2xl font-bold shadow-lg shadow-green-900/20 active:scale-95 transition-transform"
                >
                  {t.submitAd}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );

  const renderSchemes = () => {
    const schemeData = [
      { title: t.pmKisan, icon: '🌾', phone: '155261', color: 'bg-green-50 text-green-800' },
      { title: t.stateSubsidy, icon: '🚜', phone: '1800-425-3553', color: 'bg-orange-50 text-orange-800' },
      { title: t.pension, icon: '👴', phone: '1902', color: 'bg-blue-50 text-blue-800' },
      { title: t.dbt, icon: '💸', phone: '080-22373813', color: 'bg-purple-50 text-purple-800' },
    ];
    return (
      <div className="space-y-6 animate-in slide-in-from-bottom duration-300">
        <h2 className="text-2xl font-bold">{t.schemes}</h2>
        <div className="grid grid-cols-1 gap-4">
          {schemeData.map((scheme, idx) => (
            <div key={idx} className={`p-5 rounded-3xl border ${scheme.color} flex items-center justify-between shadow-sm`}>
              <div className="flex items-center gap-4">
                <span className="text-3xl">{scheme.icon}</span>
                <div>
                  <h3 className="font-bold text-sm">{scheme.title}</h3>
                  <p className="text-xs opacity-75 font-mono">{scheme.phone}</p>
                </div>
              </div>
              <a href={`tel:${scheme.phone}`} className="bg-white/80 p-3 rounded-2xl shadow-sm hover:scale-110 transition-transform">
                📞
              </a>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);

  const handlePestScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAnalyzing(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];
      const result = await analyzeCropImage(base64, lang);
      setAnalysisResult(result);
      setAnalyzing(false);
    };
    reader.readAsDataURL(file);
  };

  const renderAI = () => (
    <div className="space-y-6 text-center">
      <h2 className="text-2xl font-bold text-left">{t.pest}</h2>
      <div className="bg-white p-8 rounded-3xl shadow-sm border-2 border-dashed border-green-200">
        <div className="text-5xl mb-4">🔍</div>
        <h3 className="font-bold mb-2">Detect Diseases & Pests</h3>
        <p className="text-sm text-gray-500 mb-6">Upload a photo of your affected crop for instant AI analysis.</p>
        <label className="bg-green-700 text-white px-8 py-3 rounded-full font-bold cursor-pointer inline-block shadow-lg active:scale-95 transition-transform">
          {analyzing ? 'Analyzing...' : t.detectNow}
          <input type="file" accept="image/*" className="hidden" onChange={handlePestScan} disabled={analyzing} />
        </label>
      </div>
      {analysisResult && (
        <div className="text-left bg-white p-6 rounded-3xl shadow-sm border border-orange-100 whitespace-pre-wrap text-sm leading-relaxed animate-in fade-in slide-in-from-bottom duration-500">
           <h4 className="font-bold text-green-800 mb-2">Expert AI Advice:</h4>
           {analysisResult}
        </div>
      )}
    </div>
  );

  const [soilForm, setSoilForm] = useState({ n: 0, p: 0, k: 0, ph: 7 });
  const [soilAdvice, setSoilAdvice] = useState<string | null>(null);

  const handleSoilCheck = async () => {
    setAnalyzing(true);
    const result = await getSoilRecommendation(soilForm.n, soilForm.p, soilForm.k, soilForm.ph, lang);
    setSoilAdvice(result);
    setAnalyzing(false);
  }

  const renderSoil = () => (
    <div className="space-y-6">
        <h2 className="text-2xl font-bold">{t.soil}</h2>
        <div className="bg-white p-6 rounded-3xl shadow-sm border space-y-4">
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="text-xs font-bold text-gray-500">Nitrogen (N)</label>
                    <input type="number" className="w-full border-b-2 border-stone-200 p-2 outline-none focus:border-green-600" onChange={e => setSoilForm({...soilForm, n: Number(e.target.value)})} />
                </div>
                <div>
                    <label className="text-xs font-bold text-gray-500">Phosphorus (P)</label>
                    <input type="number" className="w-full border-b-2 border-stone-200 p-2 outline-none focus:border-green-600" onChange={e => setSoilForm({...soilForm, p: Number(e.target.value)})} />
                </div>
                <div>
                    <label className="text-xs font-bold text-gray-500">Potassium (K)</label>
                    <input type="number" className="w-full border-b-2 border-stone-200 p-2 outline-none focus:border-green-600" onChange={e => setSoilForm({...soilForm, k: Number(e.target.value)})} />
                </div>
                <div>
                    <label className="text-xs font-bold text-gray-500">Soil pH</label>
                    <input type="number" step="0.1" className="w-full border-b-2 border-stone-200 p-2 outline-none focus:border-green-600" onChange={e => setSoilForm({...soilForm, ph: Number(e.target.value)})} />
                </div>
            </div>
            <button 
                onClick={handleSoilCheck}
                disabled={analyzing}
                className="w-full bg-[#bc6c25] text-white py-3 rounded-2xl font-bold mt-4 shadow-md active:scale-95 transition-transform"
            >
                {analyzing ? 'Checking...' : 'Get Recommendation'}
            </button>
        </div>
        {soilAdvice && (
            <div className="bg-white p-6 rounded-3xl border border-stone-100 text-sm whitespace-pre-wrap animate-in fade-in duration-500">
                <h4 className="font-bold text-[#bc6c25] mb-2">Fertilizer Plan:</h4>
                {soilAdvice}
            </div>
        )}
    </div>
  );

  const renderLivestock = () => (
    <div className="space-y-6">
        <h2 className="text-2xl font-bold">{t.livestock}</h2>
        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-center gap-4">
            <div className="text-3xl">💉</div>
            <div>
                <h4 className="font-bold text-red-800">{t.vaccine}</h4>
                <p className="text-xs text-red-600">Cow ID: KA-MND-04 • Due in 3 days</p>
            </div>
        </div>
        <div className="grid grid-cols-1 gap-4">
            <div className="bg-white p-5 rounded-3xl shadow-sm border flex justify-between items-center">
                <div>
                    <p className="text-xs text-gray-500">Daily Milk Production</p>
                    <p className="text-2xl font-bold">12.5 Liters</p>
                </div>
                <div className="h-10 w-24 bg-blue-50 rounded-lg flex items-center justify-center text-blue-800 font-bold">
                    + Track
                </div>
            </div>
        </div>
    </div>
  );

  const getContent = () => {
    switch (activeTab) {
      case 'home': return renderHome();
      case 'market': return renderMarket();
      case 'marketplace': return renderMarketplace();
      case 'schemes': return renderSchemes();
      case 'tools': return (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold">{t.rent}</h2>
          <div className="grid grid-cols-1 gap-4">
            {MOCK_EQUIPMENT.map((eq) => (
              <div key={eq.id} className="bg-white rounded-3xl overflow-hidden shadow-sm flex border">
                <img src={eq.image} className="w-32 h-32 object-cover" alt={eq.name} />
                <div className="p-4 flex-1">
                  <h3 className="font-bold text-md">{eq.name}</h3>
                  <p className="text-xs text-gray-500">Owner: {eq.owner}</p>
                  <div className="mt-2 flex justify-between items-center">
                    <span className="text-lg font-bold text-green-800">₹{eq.pricePerHour}/hr</span>
                    <button className="bg-green-700 text-white px-3 py-1 rounded-lg text-xs font-bold active:scale-95 transition-transform">Book</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
      case 'ai': return renderAI();
      case 'soil': return renderSoil();
      case 'livestock': return renderLivestock();
      default: return renderHome();
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#fdfaf5] flex flex-col items-center justify-center p-6 max-w-md mx-auto shadow-2xl relative">
        <div className="w-full text-center mb-8">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-green-200">
                <span className="text-4xl">🌾</span>
            </div>
            <h1 className="text-3xl font-bold text-green-900">{t.title}</h1>
            <p className="text-sm text-gray-500 mt-1">{t.loginTitle}</p>
        </div>

        <form onSubmit={handleLogin} className="w-full space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-[#3e2723] uppercase tracking-wider">{t.phoneLabel}</label>
            <div className="relative">
                <span className="absolute left-3 top-3.5 text-gray-400">🇮🇳</span>
                <input 
                  type="tel" 
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder={t.phonePlaceholder}
                  className="w-full bg-white border border-stone-200 p-3 pl-10 rounded-2xl outline-none focus:border-green-600 transition-colors"
                />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-[#3e2723] uppercase tracking-wider">{t.passwordLabel}</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.passPlaceholder}
              className="w-full bg-white border border-stone-200 p-3 rounded-2xl outline-none focus:border-green-600 transition-colors"
            />
          </div>

          {authError && <p className="text-xs text-red-500 font-bold">{t.authError}</p>}

          <button 
            type="submit"
            className="w-full bg-green-800 text-white py-4 rounded-2xl font-bold shadow-lg active:scale-95 transition-transform"
          >
            {t.loginBtn}
          </button>
        </form>

        <div className="w-full my-6 flex items-center gap-4">
            <div className="flex-1 h-px bg-stone-200"></div>
            <span className="text-xs text-gray-400 font-bold">OR</span>
            <div className="flex-1 h-px bg-stone-200"></div>
        </div>

        <button 
          onClick={handleGoogleLogin}
          className="w-full bg-white border border-stone-200 text-gray-700 py-4 rounded-2xl font-bold shadow-sm flex items-center justify-center gap-3 active:scale-95 transition-transform"
        >
          <img src="https://www.gstatic.com/images/branding/product/1x/gsa_512dp.png" className="w-5 h-5" alt="Google" />
          {t.googleLoginBtn}
        </button>

        <div className="mt-8 text-center">
            <p className="text-sm text-gray-500">
                {t.noAccount} <span className="text-green-800 font-bold cursor-pointer hover:underline">{t.signUp}</span>
            </p>
        </div>

        <button 
          onClick={() => setLang(lang === 'en' ? 'kn' : 'en')}
          className="mt-8 px-4 py-1.5 rounded-full border border-green-700 text-xs font-bold text-green-800 bg-green-50"
        >
          {t.langToggle}
        </button>
      </div>
    );
  }

  return (
    <>
      <Layout 
        lang={lang} 
        setLang={setLang} 
        activeTab={activeTab} 
        setActiveTab={setActiveTab}
        onVoiceClick={startVoiceSession}
      >
        {getContent()}
      </Layout>

      {isVoiceActive && (
        <div className="fixed inset-0 bg-[#1b4332]/95 z-[100] flex flex-col items-center justify-center text-white p-8 animate-in fade-in duration-300">
          <div className="w-32 h-32 bg-white/10 rounded-full flex items-center justify-center relative mb-8">
            <div className="absolute inset-0 bg-white/20 rounded-full animate-ping"></div>
            <div className="absolute inset-4 bg-white/30 rounded-full animate-pulse"></div>
            <span className="text-5xl relative z-10">🎙️</span>
          </div>
          <h2 className="text-2xl font-bold mb-2">{t.voiceTitle}</h2>
          <p className="text-green-200 mb-8 animate-pulse">{t.voiceActive}</p>
          <p className="text-center text-sm text-gray-300 max-w-xs mb-12">
            {t.voiceInstruction}
          </p>
          <button 
            onClick={stopVoiceSession}
            className="bg-white text-[#1b4332] px-8 py-3 rounded-full font-bold shadow-xl hover:scale-105 transition-transform"
          >
            {t.close}
          </button>
        </div>
      )}
    </>
  );
};

export default App;
