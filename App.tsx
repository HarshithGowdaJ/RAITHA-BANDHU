
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
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
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

  const renderHome = () => (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Dynamic Weather & Risk Header */}
      <div className="rounded-[40px] p-8 text-white overflow-hidden relative shadow-2xl earth-gradient">
        <div className="relative z-10">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium opacity-80 uppercase tracking-widest">Mandya District</p>
              <h2 className="text-5xl font-black mt-1">29°C</h2>
              <p className="text-lg font-bold text-green-200">{t.lowRisk}</p>
            </div>
            <div className="text-6xl animate-pulse">☀️</div>
          </div>
          <div className="mt-6 p-4 bg-white/10 backdrop-blur-md rounded-[24px] border border-white/20 flex items-center gap-4">
            <div className="w-10 h-10 bg-orange-500 rounded-full flex items-center justify-center font-bold text-white shadow-lg">!</div>
            <p className="text-sm font-semibold leading-snug">
              {lang === 'en' ? "Heavy rain predicted in 48 hours. Start paddy harvesting immediately." : "ಮುಂದಿನ 48 ಗಂಟೆಗಳಲ್ಲಿ ಭಾರಿ ಮಳೆ ಮುನ್ಸೂಚನೆ. ಭತ್ತದ ಕೊಯ್ಲು ಕೂಡಲೇ ಪ್ರಾರಂಭಿಸಿ."}
            </p>
          </div>
        </div>
        <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-white/5 rounded-full blur-[80px]"></div>
        <div className="absolute -left-10 top-0 w-40 h-40 bg-green-400/10 rounded-full blur-[60px]"></div>
      </div>

      {/* Grid Quick Actions - "Quickly Available" */}
      <section>
        <h3 className="font-black text-xl mb-4 px-2">{lang === 'en' ? 'Quick Actions' : 'ತ್ವರಿತ ಕ್ರಿಯೆಗಳು'}</h3>
        <div className="grid grid-cols-3 gap-3">
          {[
            { id: 'soil', icon: '🌱', label: t.soil, color: 'bg-orange-50 text-orange-900 border-orange-100' },
            { id: 'ai', icon: '🔍', label: t.pest, color: 'bg-green-50 text-green-900 border-green-100' },
            { id: 'tools', icon: '🚜', label: t.rent, color: 'bg-stone-100 text-stone-900 border-stone-200' },
            { id: 'livestock', icon: '🐄', label: t.livestock, color: 'bg-blue-50 text-blue-900 border-blue-100' },
            { id: 'market', icon: '📈', label: t.market, color: 'bg-yellow-50 text-yellow-900 border-yellow-100' },
            { id: 'schemes', icon: '🏛️', label: t.schemes, color: 'bg-purple-50 text-purple-900 border-purple-100' },
          ].map((action) => (
            <button 
              key={action.id}
              onClick={() => setActiveTab(action.id)}
              className={`flex flex-col items-center justify-center aspect-square rounded-[32px] border shadow-sm active:scale-90 transition-all ${action.color}`}
            >
              <span className="text-3xl mb-1">{action.icon}</span>
              <span className="text-[10px] font-black text-center px-1 uppercase leading-tight">{action.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Live Market Pulse */}
      <section className="bg-white rounded-[40px] p-6 shadow-sm border border-stone-100">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-black text-lg">{t.currentPrice}</h3>
          <button className="text-xs font-black text-green-700 underline" onClick={() => setActiveTab('market')}>{t.viewAll}</button>
        </div>
        <div className="space-y-3">
          {MOCK_PRICES.slice(0, 3).map((p, i) => (
            <div key={i} className="flex justify-between items-center p-3 hover:bg-stone-50 rounded-2xl transition-colors">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${p.trend === 'up' ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-red-400'}`}></div>
                <div>
                  <p className="font-bold text-sm">{p.crop}</p>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">{p.mandi}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-black text-green-800">₹{p.price}</p>
                <p className="text-[10px] text-gray-400 font-medium">/ {p.unit}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Suggested Crop Planning Card */}
      <div className="bg-[#3e2723] p-7 rounded-[40px] text-white shadow-xl relative overflow-hidden">
        <div className="relative z-10">
          <h4 className="font-black text-xl mb-4 flex items-center gap-2">
            <span className="bg-white/20 p-2 rounded-xl text-lg">💡</span> {t.suggestedCrops}
          </h4>
          <div className="space-y-3">
              {[t.sugarcane, t.paddy, t.ragi].map((crop, i) => (
                  <div key={i} className="flex justify-between items-center bg-white/10 backdrop-blur-sm p-4 rounded-2xl border border-white/10">
                      <span className="font-bold">{crop}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black bg-green-500 text-white px-2 py-0.5 rounded-full">HIGH PROFIT</span>
                        <span className="text-xs opacity-80">90% Fit</span>
                      </div>
                  </div>
              ))}
          </div>
        </div>
        <div className="absolute top-0 right-0 w-32 h-32 bg-orange-400/20 rounded-full blur-3xl"></div>
      </div>
    </div>
  );

  const renderMarket = () => (
    <div className="space-y-6 animate-in slide-in-from-right duration-300">
      <h2 className="text-3xl font-black mb-4 px-2">{t.market}</h2>
      <div className="bg-white p-6 rounded-[40px] shadow-sm h-72 border border-stone-100 overflow-hidden">
        <h3 className="text-xs font-black uppercase text-stone-400 mb-6 tracking-widest">District Price Trend</h3>
        <ResponsiveContainer width="100%" height="80%">
          <LineChart data={[
            { month: 'Jan', price: 2800 },
            { month: 'Feb', price: 2900 },
            { month: 'Mar', price: 3050 },
            { month: 'Apr', price: 3150 },
          ]}>
            <XAxis dataKey="month" stroke="#a8a29e" fontSize={10} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
            <Line type="monotone" dataKey="price" stroke="#2d6a4f" strokeWidth={4} dot={{ fill: '#2d6a4f', r: 6, strokeWidth: 4, stroke: '#fff' }} activeDot={{ r: 8 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-3">
        {MOCK_PRICES.map((p, i) => (
          <div key={i} className="bg-white p-5 rounded-[32px] flex justify-between items-center shadow-sm border border-stone-50 hover:border-green-100 transition-colors">
            <div>
              <p className="font-black text-lg text-stone-800">{p.crop}</p>
              <p className="text-xs font-bold text-stone-400 uppercase">{p.mandi} Market</p>
            </div>
            <div className="text-right">
              <p className="font-black text-2xl text-green-800">₹{p.price}</p>
              <p className="text-[10px] font-bold text-stone-400">per {p.unit}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderMarketplace = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center px-2">
        <h2 className="text-3xl font-black">{t.sell}</h2>
        <button 
          onClick={() => setIsPostingAd(true)}
          className="bg-green-700 text-white px-6 py-3 rounded-full text-sm font-black shadow-lg shadow-green-900/20 active:scale-95 transition-transform"
        >
          {t.postAd}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-6">
        {marketplaceItems.map((item) => (
          <div key={item.id} className="bg-white rounded-[40px] overflow-hidden shadow-sm border border-stone-100 group">
            <div className="relative overflow-hidden aspect-[4/3]">
              <img src={item.image} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt={item.crop} />
              <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-black shadow-sm">{item.quantity}</div>
            </div>
            <div className="p-6">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-black text-xl text-stone-800">{item.crop}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-5 h-5 bg-stone-100 rounded-full flex items-center justify-center text-[10px]">👤</div>
                    <p className="text-xs font-bold text-stone-400">{item.farmerName} • {item.location}</p>
                  </div>
                </div>
              </div>
              <div className="mt-6 flex justify-between items-center">
                <span className="text-2xl font-black text-green-800">{item.price}</span>
                <button className="bg-[#bc6c25] text-white px-6 py-3 rounded-2xl text-sm font-black shadow-lg shadow-orange-900/10 active:scale-95 transition-transform">Contact</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {isPostingAd && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-md z-[60] flex items-end justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[48px] p-10 pb-12 shadow-2xl animate-in slide-in-from-bottom duration-500">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-3xl font-black text-stone-800">{t.postAd}</h2>
              <button onClick={() => setIsPostingAd(false)} className="w-10 h-10 bg-stone-100 rounded-full flex items-center justify-center text-2xl">×</button>
            </div>
            <form onSubmit={handlePostAd} className="space-y-5">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">{t.cropName}</label>
                <input 
                  type="text" 
                  required
                  value={newAd.crop}
                  onChange={e => setNewAd({...newAd, crop: e.target.value})}
                  className="w-full bg-stone-50 border-2 border-transparent p-4 rounded-[24px] outline-none focus:border-green-600 focus:bg-white transition-all"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">{t.quantity}</label>
                <input 
                  type="text" 
                  required
                  value={newAd.quantity}
                  onChange={e => setNewAd({...newAd, quantity: e.target.value})}
                  className="w-full bg-stone-50 border-2 border-transparent p-4 rounded-[24px] outline-none focus:border-green-600 focus:bg-white transition-all"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">{t.price}</label>
                  <input 
                    type="text" 
                    required
                    value={newAd.price}
                    onChange={e => setNewAd({...newAd, price: e.target.value})}
                    className="w-full bg-stone-50 border-2 border-transparent p-4 rounded-[24px] outline-none focus:border-green-600 focus:bg-white transition-all"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">{t.location}</label>
                  <input 
                    type="text" 
                    required
                    value={newAd.location}
                    onChange={e => setNewAd({...newAd, location: e.target.value})}
                    className="w-full bg-stone-50 border-2 border-transparent p-4 rounded-[24px] outline-none focus:border-green-600 focus:bg-white transition-all"
                  />
                </div>
              </div>
              <div className="pt-6 flex gap-4">
                <button 
                  type="button"
                  onClick={() => setIsPostingAd(false)}
                  className="flex-1 bg-stone-100 text-stone-600 py-4 rounded-[24px] font-black active:scale-95 transition-transform"
                >
                  {t.cancel}
                </button>
                <button 
                  type="submit"
                  className="flex-[2] bg-green-800 text-white py-4 rounded-[24px] font-black shadow-xl shadow-green-900/20 active:scale-95 transition-transform"
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
      { title: t.pmKisan, icon: '🌾', phone: '155261', color: 'bg-green-50 text-green-800 border-green-100' },
      { title: t.stateSubsidy, icon: '🚜', phone: '1800-425-3553', color: 'bg-orange-50 text-orange-800 border-orange-100' },
      { title: t.pension, icon: '👴', phone: '1902', color: 'bg-blue-50 text-blue-800 border-blue-100' },
      { title: t.dbt, icon: '💸', phone: '080-22373813', color: 'bg-purple-50 text-purple-800 border-purple-100' },
    ];
    return (
      <div className="space-y-6 animate-in slide-in-from-bottom duration-300">
        <h2 className="text-3xl font-black px-2">{t.schemes}</h2>
        <div className="grid grid-cols-1 gap-4">
          {schemeData.map((scheme, idx) => (
            <div key={idx} className={`p-6 rounded-[32px] border-2 ${scheme.color} flex items-center justify-between shadow-sm hover:shadow-md transition-shadow`}>
              <div className="flex items-center gap-5">
                <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center text-3xl shadow-sm">{scheme.icon}</div>
                <div>
                  <h3 className="font-black text-sm leading-tight mb-1">{scheme.title}</h3>
                  <p className="text-[10px] font-black opacity-60 tracking-widest">{scheme.phone}</p>
                </div>
              </div>
              <a href={`tel:${scheme.phone}`} className="bg-white p-4 rounded-2xl shadow-sm active:scale-90 transition-transform">
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
      <h2 className="text-3xl font-black text-left px-2">{t.pest}</h2>
      <div className="bg-white p-10 rounded-[40px] shadow-sm border-2 border-dashed border-stone-200">
        <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl shadow-inner">🔍</div>
        <h3 className="font-black text-xl mb-3">Instant Diagnosis</h3>
        <p className="text-sm text-stone-400 font-medium mb-8">Take a photo of your leaf or crop. Our AI will identify the problem and suggest a cure.</p>
        <label className="bg-green-700 text-white px-10 py-4 rounded-full font-black cursor-pointer inline-block shadow-xl shadow-green-900/20 active:scale-95 transition-transform">
          {analyzing ? 'ANALYZING...' : t.detectNow}
          <input type="file" accept="image/*" className="hidden" onChange={handlePestScan} disabled={analyzing} />
        </label>
      </div>
      {analysisResult && (
        <div className="text-left bg-white p-8 rounded-[32px] shadow-sm border border-orange-100 animate-in fade-in slide-in-from-bottom duration-500">
           <div className="flex items-center gap-3 mb-4">
             <div className="w-8 h-8 bg-green-800 text-white rounded-full flex items-center justify-center text-xs">AI</div>
             <h4 className="font-black text-green-800 tracking-wide uppercase text-xs">Expert Analysis</h4>
           </div>
           <div className="text-sm font-medium leading-relaxed text-stone-700 whitespace-pre-wrap">{analysisResult}</div>
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
        <h2 className="text-3xl font-black px-2">{t.soil}</h2>
        <div className="bg-white p-8 rounded-[40px] shadow-sm border border-stone-100 space-y-6">
            <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1">
                    <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">Nitrogen (N)</label>
                    <input type="number" className="w-full bg-stone-50 border-2 border-transparent p-4 rounded-[20px] outline-none focus:border-green-600 focus:bg-white transition-all" onChange={e => setSoilForm({...soilForm, n: Number(e.target.value)})} />
                </div>
                <div className="space-y-1">
                    <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">Phosphorus (P)</label>
                    <input type="number" className="w-full bg-stone-50 border-2 border-transparent p-4 rounded-[20px] outline-none focus:border-green-600 focus:bg-white transition-all" onChange={e => setSoilForm({...soilForm, p: Number(e.target.value)})} />
                </div>
                <div className="space-y-1">
                    <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">Potassium (K)</label>
                    <input type="number" className="w-full bg-stone-50 border-2 border-transparent p-4 rounded-[20px] outline-none focus:border-green-600 focus:bg-white transition-all" onChange={e => setSoilForm({...soilForm, k: Number(e.target.value)})} />
                </div>
                <div className="space-y-1">
                    <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">Soil pH</label>
                    <input type="number" step="0.1" className="w-full bg-stone-50 border-2 border-transparent p-4 rounded-[20px] outline-none focus:border-green-600 focus:bg-white transition-all" onChange={e => setSoilForm({...soilForm, ph: Number(e.target.value)})} />
                </div>
            </div>
            <button 
                onClick={handleSoilCheck}
                disabled={analyzing}
                className="w-full bg-[#bc6c25] text-white py-4 rounded-[24px] font-black shadow-lg shadow-orange-900/20 active:scale-95 transition-transform"
            >
                {analyzing ? 'Calculating...' : 'Get Fertility Plan'}
            </button>
        </div>
        {soilAdvice && (
            <div className="bg-white p-8 rounded-[32px] border border-stone-100 text-sm font-medium leading-relaxed whitespace-pre-wrap animate-in fade-in duration-500">
                <h4 className="font-black text-[#bc6c25] mb-4 uppercase text-xs tracking-widest border-b pb-2">Optimal Fertilizer Plan</h4>
                {soilAdvice}
            </div>
        )}
    </div>
  );

  const renderLivestock = () => (
    <div className="space-y-6">
        <h2 className="text-3xl font-black px-2">{t.livestock}</h2>
        <div className="bg-red-50 border-2 border-red-100 p-6 rounded-[32px] flex items-center gap-5 shadow-sm">
            <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center text-3xl shadow-sm">💉</div>
            <div>
                <h4 className="font-black text-red-800 uppercase text-xs tracking-widest mb-1">{t.vaccine}</h4>
                <p className="text-sm font-bold text-red-600">Cow ID: KA-MND-04 • Due in 3 days</p>
            </div>
        </div>
        <div className="grid grid-cols-1 gap-4">
            <div className="bg-white p-6 rounded-[32px] shadow-sm border border-stone-50 flex justify-between items-center group hover:border-blue-200 transition-colors">
                <div>
                    <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-1">Daily Yield</p>
                    <p className="text-3xl font-black text-stone-800">12.5 <span className="text-lg opacity-40">L</span></p>
                </div>
                <button className="bg-blue-50 text-blue-800 px-6 py-3 rounded-2xl font-black text-xs active:scale-95 transition-transform">
                    + Track
                </button>
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
          <h2 className="text-3xl font-black px-2">{t.rent}</h2>
          <div className="grid grid-cols-1 gap-6">
            {MOCK_EQUIPMENT.map((eq) => (
              <div key={eq.id} className="bg-white rounded-[40px] overflow-hidden shadow-sm flex border border-stone-50 hover:border-stone-200 transition-all">
                <img src={eq.image} className="w-32 h-full object-cover" alt={eq.name} />
                <div className="p-6 flex-1">
                  <h3 className="font-black text-lg text-stone-800">{eq.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="w-4 h-4 bg-stone-100 rounded-full flex items-center justify-center text-[8px]">👤</span>
                    <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest">{eq.owner}</p>
                  </div>
                  <div className="mt-6 flex justify-between items-center">
                    <span className="text-xl font-black text-green-800">₹{eq.pricePerHour}<span className="text-xs opacity-40">/HR</span></span>
                    <button className="bg-green-700 text-white px-5 py-2 rounded-xl text-xs font-black shadow-lg shadow-green-900/10 active:scale-95 transition-transform">Book</button>
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
      <div className="min-h-screen bg-[#fdfaf5] flex flex-col items-center justify-center p-8 max-w-md mx-auto shadow-2xl relative">
        <div className="w-full text-center mb-10">
            <div className="w-24 h-24 bg-green-100 rounded-[32px] flex items-center justify-center mx-auto mb-6 border-4 border-green-50 shadow-xl">
                <span className="text-5xl">🌾</span>
            </div>
            <h1 className="text-4xl font-black text-green-900 tracking-tight">{t.title}</h1>
            <p className="text-sm font-bold text-stone-400 mt-2 tracking-wide uppercase">{t.loginTitle}</p>
        </div>

        <form onSubmit={handleLogin} className="w-full space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-2">{t.phoneLabel}</label>
            <div className="relative">
                <span className="absolute left-4 top-4 text-gray-400 font-bold">🇮🇳</span>
                <input 
                  type="tel" 
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder={t.phonePlaceholder}
                  className="w-full bg-white border-2 border-stone-100 p-4 pl-12 rounded-[24px] outline-none focus:border-green-600 focus:shadow-lg focus:shadow-green-900/5 transition-all"
                />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-2">{t.passwordLabel}</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.passPlaceholder}
              className="w-full bg-white border-2 border-stone-100 p-4 rounded-[24px] outline-none focus:border-green-600 focus:shadow-lg focus:shadow-green-900/5 transition-all"
            />
          </div>

          {authError && <p className="text-xs text-red-500 font-black px-2">{t.authError}</p>}

          <button 
            type="submit"
            className="w-full bg-green-800 text-white py-5 rounded-[24px] font-black text-lg shadow-2xl shadow-green-900/40 active:scale-95 transition-all"
          >
            {t.loginBtn}
          </button>
        </form>

        <div className="w-full my-10 flex items-center gap-6">
            <div className="flex-1 h-px bg-stone-200"></div>
            <span className="text-[10px] text-stone-400 font-black">SECURE LOGIN</span>
            <div className="flex-1 h-px bg-stone-200"></div>
        </div>

        <button 
          onClick={handleGoogleLogin}
          className="w-full bg-white border-2 border-stone-100 text-stone-800 py-5 rounded-[24px] font-black shadow-sm flex items-center justify-center gap-4 active:scale-95 transition-all hover:bg-stone-50"
        >
          <img src="https://www.gstatic.com/images/branding/product/1x/gsa_512dp.png" className="w-6 h-6" alt="Google" />
          {t.googleLoginBtn}
        </button>

        <div className="mt-10 text-center">
            <p className="text-sm font-bold text-stone-400">
                {t.noAccount} <span className="text-green-800 font-black cursor-pointer hover:underline">{t.signUp}</span>
            </p>
        </div>

        <button 
          onClick={() => setLang(lang === 'en' ? 'kn' : 'en')}
          className="mt-10 px-6 py-2 rounded-full border-2 border-green-700 text-[10px] font-black uppercase tracking-widest text-green-800 bg-green-50 shadow-sm"
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
        <div className="fixed inset-0 bg-stone-900/95 z-[100] flex flex-col items-center justify-center text-white p-8 animate-in fade-in duration-500">
          <div className="w-40 h-40 bg-white/10 rounded-full flex items-center justify-center relative mb-12">
            <div className="absolute inset-0 bg-white/20 rounded-full animate-ping"></div>
            <div className="absolute inset-6 bg-white/30 rounded-full animate-pulse"></div>
            <span className="text-6xl relative z-10">🎙️</span>
          </div>
          <h2 className="text-3xl font-black mb-2">{t.voiceTitle}</h2>
          <p className="text-green-300 font-black uppercase tracking-[0.2em] mb-10 text-xs animate-pulse">{t.voiceActive}</p>
          <p className="text-center text-sm font-medium text-stone-300 max-w-xs mb-16 leading-relaxed">
            {t.voiceInstruction}
          </p>
          <button 
            onClick={stopVoiceSession}
            className="bg-white text-stone-900 px-12 py-4 rounded-full font-black text-lg shadow-2xl active:scale-95 transition-transform"
          >
            {t.close}
          </button>
        </div>
      )}
    </>
  );
};

export default App;
