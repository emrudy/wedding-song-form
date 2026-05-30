import { useState, useEffect, useMemo, useRef } from "react";
import { db } from "./firebase";
import { collection, onSnapshot, doc, setDoc, getDoc } from "firebase/firestore";
import emailjs from "@emailjs/browser";

// ── Constants ─────────────────────────────────────────────────────────────
const VIOLINIST_NAME  = "Emily Hart";
const VIOLINIST_EMAIL = "emily@musicfromthehart.com";

// EmailJS config — fill these in after setting up EmailJS
const EMAILJS_SERVICE_ID  = "YOUR_SERVICE_ID";
const EMAILJS_TEMPLATE_ID = "YOUR_TEMPLATE_ID";
const EMAILJS_PUBLIC_KEY  = "YOUR_PUBLIC_KEY";

const SECTIONS = [
  {
    id: "preceremony",
    label: "Pre-Ceremony",
    multi: true,
    maxMinutes: 45,
    description: "Music played as guests are seated before the ceremony begins.",
    note: "Your pre-ceremony set list runs approximately 30 minutes. We include 45 minutes of music as a buffer in case of a late start.",
  },
  {
    id: "bridalPartyProcessional",
    label: "Bridal Party Processional",
    multi: false,
    maxMinutes: null,
    description: "The song played as the bridal party walks down the aisle.",
    note: null,
    allowCustom: true,
  },
  {
    id: "bridalProcessional",
    label: "Bridal Processional",
    multi: false,
    maxMinutes: null,
    description: "The song played as the bride walks down the aisle.",
    note: null,
    allowCustom: true,
  },
  {
    id: "recessional",
    label: "Bride & Groom Recessional",
    multi: false,
    maxMinutes: null,
    description: "The song played as the newly married couple exits.",
    note: null,
    allowCustom: true,
  },
  {
    id: "postceremony",
    label: "Post-Ceremony Guest Exit",
    multi: true,
    maxMinutes: 30,
    description: "Music played as guests exit after the ceremony.",
    note: null,
  },
  {
    id: "cocktailhour",
    label: "Cocktail Hour",
    multi: true,
    maxMinutes: 60,
    description: "Background music during the cocktail reception.",
    note: null,
    optional: true,
  },
];

// ── Duration helpers ───────────────────────────────────────────────────────
const parseDuration = (s) => {
  if (!s) return 0;
  const parts = s.split(":").map(Number);
  return parts.length === 2 ? (parts[0]||0)*60 + (parts[1]||0) : 0;
};
const formatMins = (secs) => {
  const m = Math.floor(secs/60);
  const rem = secs%60;
  return rem > 0 ? `${m} min ${rem} sec` : `${m} min`;
};

// ── YouTube helpers ────────────────────────────────────────────────────────
const getYouTubeId = (url) => {
  if (!url) return null;
  const patterns = [/[?&]v=([^&#]+)/, /youtu\.be\/([^?&#]+)/, /youtube\.com\/embed\/([^?&#]+)/];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
  return null;
};

// ── Tokens ─────────────────────────────────────────────────────────────────
const tk = {
  accent:  "#c8a96e",
  accent2: "#e8d5b0",
  accentDark: "#a8864e",
  bg:      "#faf9f7",
  surface: "#ffffff",
  surface2:"#f5f3ef",
  surface3:"#ede9e3",
  border:  "rgba(0,0,0,0.07)",
  borderStrong: "rgba(0,0,0,0.12)",
  text:    "#1a1714",
  textSub: "#7a7570",
  textMuted:"#b5b0a8",
  green:   "#4a9e6e",
  red:     "#d95c4a",
  shadow:  "0 4px 24px rgba(0,0,0,0.08)",
  shadowSm:"0 2px 8px rgba(0,0,0,0.06)",
};

const STEPS = ["Your Details", "Song Selections", "Review & Submit"];

export default function ClientForm() {
  const [songs, setSongs]           = useState([]);
  const [loadingSongs, setLoadingSongs] = useState(true);
  const [step, setStep]             = useState(0);
  const [clientId, setClientId]     = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [playingId, setPlayingId]   = useState(null);

  const [clientName, setClientName]       = useState("");
  const [partnerName, setPartnerName]     = useState("");
  const [weddingDate, setWeddingDate]     = useState("");
  const [clientEmail, setClientEmail]     = useState("");
  const [includecocktail, setIncludecocktail] = useState(false);

  const [selections, setSelections] = useState({
    preceremony: [],
    bridalPartyProcessional: null,
    bridalProcessional: null,
    recessional: null,
    postceremony: [],
    cocktailhour: [],
  });

  const [customRequests, setCustomRequests] = useState({
    bridalPartyProcessional: "",
    bridalProcessional: "",
    recessional: "",
  });

  const updCustom = (sectionId, value) => {
    setCustomRequests(prev => {
      const next = { ...prev, [sectionId]: value };
      autoSave(clientId, { clientName, partnerName, weddingDate, clientEmail, selections, customRequests: next });
      return next;
    });
  };

  const [expandedSections, setExpandedSections] = useState({ preceremony: true });
  const toggleSection = (id) => setExpandedSections(prev => ({ ...prev, [id]: !prev[id] }));

  const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => {
    const h = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  const isMobile = windowWidth < 768;

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "songs"), (snap) => {
      setSongs(snap.docs.map(d => ({ ...d.data(), id: d.id })).sort((a,b)=>a.title.localeCompare(b.title)));
      setLoadingSongs(false);
    });
    return () => unsub();
  }, []);

  const autoSave = async (id, data) => {
    if (!id) return;
    try {
      await setDoc(doc(db, "clientForms", id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
    } catch(e) { console.error("Autosave failed", e); }
  };

  const startForm = () => {
    const id = `client_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    setClientId(id);
    setStep(1);
  };

  const sectionTime = (sectionId) => {
    const sec = SECTIONS.find(s=>s.id===sectionId);
    if (!sec) return 0;
    if (sec.multi) {
      const ids = selections[sectionId] || [];
      return ids.reduce((acc, id) => {
        const song = songs.find(s=>s.id===id);
        return acc + parseDuration(song?.duration||"");
      }, 0);
    }
    const song = songs.find(s=>s.id===selections[sectionId]);
    return parseDuration(song?.duration||"");
  };

  const toggleMulti = (sectionId, songId) => {
    setSelections(prev => {
      const current = prev[sectionId] || [];
      const already = current.includes(songId);
      const updated = already ? current.filter(id=>id!==songId) : [...current, songId];
      const newState = { ...prev, [sectionId]: updated };
      autoSave(clientId, { clientName, partnerName, weddingDate, clientEmail, selections: newState });
      return newState;
    });
  };

  const setSingle = (sectionId, songId) => {
    setSelections(prev => {
      const newState = { ...prev, [sectionId]: prev[sectionId]===songId ? null : songId };
      autoSave(clientId, { clientName, partnerName, weddingDate, clientEmail, selections: newState });
      return newState;
    });
  };

  const detailsValid = clientName.trim() && weddingDate && clientEmail.trim().includes("@");

  const selectionsValid = useMemo(() => {
    const required = ["bridalPartyProcessional","bridalProcessional","recessional"];
    for (const r of required) {
      if (!selections[r] && !customRequests[r]?.trim()) return false;
    }
    if ((selections.preceremony||[]).length === 0) return false;
    if ((selections.postceremony||[]).length === 0) return false;
    return true;
  }, [selections, customRequests]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const getSongName = (id) => { const s = songs.find(x=>x.id===id); return s ? `${s.title} — ${s.artist}${s.duration?` (${s.duration})`:""}` : "—"; };
      const getMultiNames = (ids) => (ids||[]).map(id=>getSongName(id)).join("\n  • ");

      const body = `
NEW WEDDING SONG SELECTION
===========================
Client: ${clientName}
Partner: ${partnerName||"—"}
Wedding Date: ${weddingDate}
Email: ${clientEmail}

SELECTIONS:
-----------
Pre-Ceremony (${formatMins(sectionTime("preceremony"))}):
  • ${getMultiNames(selections.preceremony)}

Bridal Party Processional:
  • ${selections.bridalPartyProcessional ? getSongName(selections.bridalPartyProcessional) : `Custom request: "${customRequests.bridalPartyProcessional}"`}

Bridal Processional:
  • ${selections.bridalProcessional ? getSongName(selections.bridalProcessional) : `Custom request: "${customRequests.bridalProcessional}"`}

Bride & Groom Recessional:
  • ${selections.recessional ? getSongName(selections.recessional) : `Custom request: "${customRequests.recessional}"`}

Post-Ceremony Guest Exit (${formatMins(sectionTime("postceremony"))}):
  • ${getMultiNames(selections.postceremony)}

${includecocktail ? `Cocktail Hour (${formatMins(sectionTime("cocktailhour"))}):
  • ${getMultiNames(selections.cocktailhour)}` : "Cocktail Hour: Not requested"}
      `.trim();

      await emailjs.send(
        EMAILJS_SERVICE_ID,
        EMAILJS_TEMPLATE_ID,
        { to_email: VIOLINIST_EMAIL, to_name: VIOLINIST_NAME, from_name: clientName, from_email: clientEmail, wedding_date: weddingDate, message: body },
        EMAILJS_PUBLIC_KEY
      );

      await setDoc(doc(db, "clientForms", clientId), {
        clientName, partnerName, weddingDate, clientEmail,
        selections, customRequests, submittedAt: new Date().toISOString(), status: "submitted"
      });

      setStep(4);
    } catch(e) {
      console.error("Submit failed", e);
      alert("There was an issue submitting your form. Please try again or contact Emily directly.");
    }
    setSubmitting(false);
  };

  const playerRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const ytApiReady = useRef(false);

  // Load YouTube IFrame API once
  useEffect(() => {
    if (window.YT) { ytApiReady.current = true; return; }
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => { ytApiReady.current = true; };
  }, []);

  // When playingId changes, load and play the new video
  useEffect(() => {
    if (!playingId || !playingYtId) {
      if (ytPlayerRef.current) { try { ytPlayerRef.current.stopVideo(); } catch(e){} }
      return;
    }
    const initPlayer = () => {
      if (ytPlayerRef.current) {
        try { ytPlayerRef.current.loadVideoById(playingYtId); } catch(e){}
      } else if (playerRef.current) {
        ytPlayerRef.current = new window.YT.Player(playerRef.current, {
          height:"1", width:"1",
          videoId: playingYtId,
          playerVars: { autoplay:1, playsinline:1, controls:0, rel:0, modestbranding:1 },
          events: { onReady: (e) => { try { e.target.playVideo(); } catch(err){} } }
        });
      }
    };
    if (ytApiReady.current && window.YT?.Player) initPlayer();
    else { const t = setInterval(() => { if (ytApiReady.current && window.YT?.Player) { clearInterval(t); initPlayer(); } }, 100); return () => clearInterval(t); }
  }, [playingId, playingYtId]);
  const visibleSections = SECTIONS.filter(s => !s.optional || includecocktail);
  const playingSong = songs.find(s => s.id === playingId);
  const playingYtId = playingSong ? getYouTubeId(playingSong.youtubeUrl) : null;

  const SongRow = ({ song, selected, onClick, isSingle }) => {
    const ytId = getYouTubeId(song.youtubeUrl);
    const isPlaying = playingId === song.id;
    const handlePlay = (e) => {
      e.stopPropagation();
      setPlayingId(isPlaying ? null : song.id);
    };
    return (
      <div onClick={onClick}
        style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:selected?tk.accent+"10":tk.surface,border:`1.5px solid ${selected?tk.accent:tk.border}`,borderRadius:12,cursor:"pointer",transition:"all 0.15s",boxShadow:selected?`0 0 0 3px ${tk.accent}18`:"none"}}>
        <div style={{width:20,height:20,borderRadius:isSingle?"50%":"6px",border:`2px solid ${selected?tk.accent:tk.textMuted}`,background:selected?tk.accent:"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>
          {selected && <div style={{width:8,height:8,borderRadius:isSingle?"50%":"2px",background:"#fff"}}/>}
        </div>
        <div style={{flex:1,minWidth:0,textAlign:"left"}}>
          <div style={{fontSize:14,fontWeight:600,color:tk.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{song.title}</div>
          <div style={{fontSize:12,color:tk.textSub,display:"flex",gap:8,alignItems:"center",marginTop:1}}>
            <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{song.artist}</span>
            {song.duration && <span style={{flexShrink:0,color:tk.textMuted}}>· {song.duration}</span>}
          </div>
        </div>
        {ytId && (
          <button onClick={handlePlay}
            style={{flexShrink:0,width:34,height:34,borderRadius:"50%",background:isPlaying?tk.accent:tk.surface2,border:`1.5px solid ${isPlaying?tk.accent:tk.borderStrong}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s",WebkitTapHighlightColor:"transparent",fontFamily:"inherit"}}
            title={isPlaying?"Stop preview":"Play preview"}>
            {isPlaying
              ? <span style={{width:10,height:10,display:"grid",gridTemplateColumns:"1fr 1fr",gap:2}}>
                  <span style={{background:"#fff",borderRadius:1}}/><span style={{background:"#fff",borderRadius:1}}/>
                </span>
              : <span style={{width:0,height:0,borderStyle:"solid",borderWidth:"5px 0 5px 9px",borderColor:`transparent transparent transparent ${tk.accentDark}`,marginLeft:2}}/>
            }
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        html{-webkit-text-size-adjust:100%;}
        body{background:${tk.bg};}
        input,select,textarea{font-family:'DM Sans',-apple-system,sans-serif!important;}
        input:focus,select:focus,textarea:focus{outline:none;border-color:${tk.accent}!important;box-shadow:0 0 0 3px ${tk.accent}28!important;}
        ::placeholder{color:${tk.textMuted}!important;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
        @keyframes audioBar0{from{height:4px}to{height:10px}}
        @keyframes audioBar1{from{height:6px}to{height:16px}}
        @keyframes audioBar2{from{height:3px}to{height:8px}}
        @keyframes audioBar3{from{height:5px}to{height:13px}}
        .fade-up{animation:fadeUp 0.4s ease both;}
        select{-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2386868b' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;}
      `}</style>

      <div style={{minHeight:"100vh",background:tk.bg,fontFamily:"'DM Sans',-apple-system,sans-serif",color:tk.text}}>

        <div style={{height:4,background:`linear-gradient(90deg,${tk.accent},${tk.accent2},${tk.accent})`}}/>

        <header style={{background:tk.surface,borderBottom:`1px solid ${tk.border}`,padding:isMobile?"20px 20px":"28px 40px"}}>
          <div style={{maxWidth:760,margin:"0 auto",textAlign:"center"}}>
            <div style={{fontFamily:"'SF Pro Display',-apple-system,'DM Sans',sans-serif",fontSize:isMobile?22:28,fontWeight:700,color:tk.text,letterSpacing:-0.4,lineHeight:1}}>Emily Hart</div>
            <div style={{fontSize:12,color:tk.textSub,marginTop:5,letterSpacing:2,textTransform:"uppercase"}}>Music From The Hart</div>
          </div>
        </header>

        {step >= 1 && step <= 3 && (
          <div style={{background:tk.surface,borderBottom:`1px solid ${tk.border}`,padding:"16px 20px"}}>
            <div style={{maxWidth:760,margin:"0 auto"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",width:"100%",maxWidth:480,margin:"0 auto"}}>
                {STEPS.map((label,i) => {
                  const done = i < step - 1;
                  const active = i === step - 1;
                  return (
                    <div key={i} style={{display:"flex",alignItems:"center",flex:1,justifyContent:i===0?"flex-end":i===STEPS.length-1?"flex-start":"center"}}>
                      {i>0 && <div style={{flex:1,height:1,background:done?tk.accent:tk.surface3,transition:"background 0.3s"}}/>}
                      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,padding:"0 8px"}}>
                        <div style={{width:24,height:24,borderRadius:"50%",background:done||active?tk.accent:tk.surface3,border:`2px solid ${done||active?tk.accent:tk.borderStrong}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:done||active?"#fff":tk.textMuted,transition:"all 0.2s"}}>
                          {done?"✓":i+1}
                        </div>
                        <span style={{fontSize:11,fontWeight:active?600:400,color:active?tk.accent:tk.textSub,whiteSpace:"nowrap",textAlign:"center"}}>{label}</span>
                      </div>
                      {i<STEPS.length-1 && <div style={{flex:1,height:1,background:done||i<step-1?tk.accent:tk.surface3,transition:"background 0.3s"}}/>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <main style={{maxWidth:760,margin:"0 auto",padding:isMobile?"24px 16px 60px":"40px 24px 80px"}}>

          {/* ── STEP 0: Welcome ── */}
          {step === 0 && (
            <div style={{textAlign:"center",maxWidth:560,margin:"0 auto"}} className="fade-up">
              <div style={{width:64,height:2,background:`linear-gradient(90deg,${tk.accent},${tk.accent2})`,margin:"0 auto 32px",borderRadius:1}}/>
              <h1 style={{fontFamily:"'SF Pro Display',-apple-system,'DM Sans',sans-serif",fontSize:isMobile?28:38,fontWeight:700,color:tk.text,letterSpacing:-0.5,marginBottom:16,lineHeight:1.15}}>Song Selections</h1>
              <p style={{fontSize:16,color:tk.textSub,lineHeight:1.7,marginBottom:12}}>Welcome! I'm so honored to be a part of your special day. This form will guide you through selecting the perfect songs for each moment of your ceremony.</p>
              <p style={{fontSize:15,color:tk.textSub,lineHeight:1.7,marginBottom:32}}>Your progress is saved automatically, so you can return and finish at any time.</p>
              <div style={{background:tk.accent+"12",border:`1px solid ${tk.accent}30`,borderRadius:14,padding:"16px 20px",marginBottom:32,textAlign:"center"}}>
                <div style={{fontSize:13,fontWeight:600,color:tk.accentDark,marginBottom:6,letterSpacing:0.3,textTransform:"uppercase"}}>A Note About The Song Previews</div>
                <div style={{fontSize:14,color:tk.textSub,lineHeight:1.6}}>Where available, each song includes a reference audio preview. These recordings are provided solely to help you identify the piece — they are <em>not</em> a representation of your wedding performance. Your ceremony music will be a live, personal violin cover performed by {VIOLINIST_NAME}.</div>
              </div>
              <button onClick={startForm} style={{background:`linear-gradient(135deg,${tk.accent},${tk.accentDark})`,color:"#fff",border:"none",borderRadius:14,padding:"15px 40px",fontSize:16,fontWeight:600,cursor:"pointer",fontFamily:"inherit",boxShadow:`0 4px 20px ${tk.accent}44`,letterSpacing:0.2}}>
                Begin Song Selections →
              </button>
            </div>
          )}

          {/* ── STEP 1: Client Details ── */}
          {step === 1 && (
            <div className="fade-up">
              <h2 style={{fontFamily:"'SF Pro Display',-apple-system,'DM Sans',sans-serif",fontSize:isMobile?26:34,fontWeight:500,color:tk.text,marginBottom:6}}>Tell Me About Your Day</h2>
              <p style={{fontSize:14,color:tk.textSub,marginBottom:28,lineHeight:1.6}}>This helps me personalize your experience and keep your selections organized.</p>
              <div style={{background:tk.surface,borderRadius:18,padding:isMobile?"20px":"28px",border:`1px solid ${tk.border}`,boxShadow:tk.shadow,marginBottom:24}}>
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:16,width:"100%"}}>
                  <FormField label="Your Name" value={clientName} onChange={setClientName} placeholder="e.g. Sarah Johnson" required tk={tk} isMobile={isMobile}/>
                  <FormField label="Partner's Name" value={partnerName} onChange={setPartnerName} placeholder="e.g. James Williams" tk={tk} isMobile={isMobile}/>
                  <FormField label="Wedding Date" value={weddingDate} onChange={setWeddingDate} type="date" required tk={tk} isMobile={isMobile}/>
                  <FormField label="Your Email" value={clientEmail} onChange={setClientEmail} placeholder="your@email.com" type="email" required tk={tk} isMobile={isMobile}/>
                </div>
                <div style={{marginTop:16,paddingTop:16,borderTop:`1px solid ${tk.border}`}}>
                  <div style={{fontSize:13,fontWeight:600,color:tk.textSub,textTransform:"uppercase",letterSpacing:0.4,marginBottom:12}}>Optional Add-On</div>
                  <div onClick={()=>setIncludecocktail(!includecocktail)}
                    style={{display:"flex",alignItems:"center",gap:12,cursor:"pointer",background:includecocktail?tk.accent+"10":tk.surface2,borderRadius:12,padding:"14px 16px",border:`1.5px solid ${includecocktail?tk.accent:tk.border}`,transition:"all 0.15s"}}>
                    <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${includecocktail?tk.accent:tk.textMuted}`,background:includecocktail?tk.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s",flexShrink:0}}>
                      {includecocktail && <div style={{color:"#fff",fontSize:13,fontWeight:700}}>✓</div>}
                    </div>
                    <div>
                      <div style={{fontSize:14,fontWeight:600,color:tk.text,textAlign:"left"}}>Include Cocktail Hour Music</div>
                      <div style={{fontSize:12,color:tk.textSub,marginTop:2,textAlign:"left"}}>Add 60 minutes of background music during cocktail hour</div>
                    </div>
                  </div>
                </div>
              </div>
              <div style={{display:"flex",justifyContent:"center"}}>
                <button onClick={()=>{ autoSave(clientId,{clientName,partnerName,weddingDate,clientEmail,selections}); setStep(2); }}
                  disabled={!detailsValid}
                  style={{background:detailsValid?`linear-gradient(135deg,${tk.accent},${tk.accentDark})`:"#ccc",color:"#fff",border:"none",borderRadius:12,padding:"12px 32px",fontSize:15,fontWeight:600,cursor:detailsValid?"pointer":"not-allowed",fontFamily:"inherit",transition:"all 0.15s"}}>
                  Continue to Song Selections →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Song Selections ── */}
          {step === 2 && (
            <div className="fade-up">
              <h2 style={{fontFamily:"'SF Pro Display',-apple-system,'DM Sans',sans-serif",fontSize:isMobile?26:34,fontWeight:500,color:tk.text,marginBottom:6}}>Choose Your Songs</h2>
              <p style={{fontSize:14,color:tk.textSub,marginBottom:28,lineHeight:1.6}}>Browse the full repertoire for each moment of your ceremony. Click any song to select it, and use the preview player to hear a reference recording.</p>
              <div style={{background:tk.accent+"0d",border:`1px solid ${tk.accent}25`,borderRadius:12,padding:"12px 16px",marginBottom:28,textAlign:"center"}}>
                <div style={{fontSize:13,fontWeight:600,color:tk.accentDark,textTransform:"uppercase",letterSpacing:0.3,marginBottom:6}}>About The Previews</div>
                <div style={{fontSize:13,color:tk.textSub,lineHeight:1.8}}>
                  Audio samples are reference recordings only.<br/>
                  Your wedding music will be performed live on violin by {VIOLINIST_NAME}.
                </div>
              </div>

              {loadingSongs ? (
                <div style={{textAlign:"center",padding:"40px",color:tk.textSub}}>Loading song list…</div>
              ) : (
                visibleSections.map((section) => {
                  const totalSecs = sectionTime(section.id);
                  const maxSecs = section.maxMinutes ? section.maxMinutes * 60 : null;
                  const over = maxSecs && totalSecs > maxSecs;
                  const selCount = section.multi ? (selections[section.id]||[]).length : (selections[section.id]?1:0);
                  const isExpanded = !!expandedSections[section.id];

                  return (
                    <div key={section.id} style={{marginBottom:24,background:tk.surface,borderRadius:18,border:`1px solid ${isExpanded?tk.accent+"40":tk.border}`,boxShadow:tk.shadowSm,overflow:"hidden",transition:"border-color 0.2s"}}>
                      <div onClick={()=>toggleSection(section.id)}
                        style={{padding:"20px 24px 16px",borderBottom:isExpanded?`1px solid ${tk.border}`:"none",textAlign:"center",background:isExpanded?tk.accent+"06":tk.surface,cursor:"pointer",userSelect:"none",position:"relative",transition:"background 0.2s"}}>
                        <div style={{position:"absolute",right:18,top:"50%",transform:`translateY(-50%) rotate(${isExpanded?180:0}deg)`,transition:"transform 0.25s",color:tk.textMuted,fontSize:14,lineHeight:1}}>⌃</div>
                        <h3 style={{fontSize:isMobile?13:14,fontFamily:"'SF Pro Display',-apple-system,'DM Sans',sans-serif",fontWeight:700,color:tk.text,letterSpacing:1.4,textTransform:"uppercase",marginBottom:4}}>
                          {section.label}
                          {section.optional && <span style={{fontSize:11,fontWeight:400,color:tk.textSub,marginLeft:8,fontFamily:"'DM Sans',sans-serif",textTransform:"none",letterSpacing:0}}>Optional</span>}
                        </h3>
                        <div style={{fontSize:12,color:tk.textSub}}>{section.description}</div>
                        {section.multi && maxSecs && (
                          <div style={{display:"flex",justifyContent:"center",marginTop:10}}>
                            <div style={{background:over?tk.red+"15":tk.green+"15",border:`1px solid ${over?tk.red+"40":tk.green+"40"}`,borderRadius:20,padding:"4px 14px",fontSize:12,fontWeight:600,color:over?tk.red:tk.green,whiteSpace:"nowrap"}}>
                              {formatMins(totalSecs)} / {section.maxMinutes} min
                            </div>
                          </div>
                        )}
                        {!section.multi && selCount>0 && (
                          <div style={{display:"flex",justifyContent:"center",marginTop:10}}>
                            <div style={{background:tk.green+"15",border:`1px solid ${tk.green+"40"}`,borderRadius:20,padding:"4px 14px",fontSize:12,fontWeight:600,color:tk.green}}>✓ Selected</div>
                          </div>
                        )}
                      </div>

                      {isExpanded && <>
                        {section.note && (
                          <div style={{fontSize:12,color:tk.accentDark,background:tk.accent+"0d",borderBottom:`1px solid ${tk.border}`,padding:"10px 20px",lineHeight:1.5,textAlign:"center"}}>{section.note}</div>
                        )}
                        {over && (
                          <div style={{fontSize:12,color:tk.red,background:tk.red+"0d",borderBottom:`1px solid ${tk.border}`,padding:"10px 20px",lineHeight:1.5,textAlign:"center"}}>
                            You've exceeded the {section.maxMinutes}-minute limit by {formatMins(totalSecs - maxSecs)}. Please remove a song or two.
                          </div>
                        )}
                        <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:8}}>
                          {songs.map(song => {
                            const selected = section.multi
                              ? (selections[section.id]||[]).includes(song.id)
                              : selections[section.id] === song.id;
                            return (
                              <SongRow key={song.id} song={song} selected={selected} isSingle={!section.multi}
                                onClick={() => section.multi ? toggleMulti(section.id, song.id) : setSingle(section.id, song.id)}
                              />
                            );
                          })}
                        </div>
                        {section.allowCustom && (
                          <div style={{margin:"0 16px 16px",background:tk.surface2,borderRadius:12,padding:"14px 16px",border:`1.5px solid ${customRequests[section.id]?.trim()?tk.accent:tk.border}`}}>
                            <div style={{fontSize:12,fontWeight:600,color:tk.textSub,textTransform:"uppercase",letterSpacing:0.4,marginBottom:6}}>Don't See The Song You Want?</div>
                            <div style={{fontSize:13,color:tk.textSub,marginBottom:10,lineHeight:1.5}}>Enter a custom song request below. {VIOLINIST_NAME} will review it and be in touch to discuss whether it can be arranged for violin.</div>
                            <input value={customRequests[section.id]||""}
                              onChange={e => { updCustom(section.id, e.target.value); if (e.target.value.trim()) setSingle(section.id, null); }}
                              placeholder="e.g. Perfect – Ed Sheeran"
                              style={{width:"100%",padding:"10px 13px",border:`1px solid ${tk.borderStrong}`,borderRadius:10,fontSize:15,background:tk.surface,color:tk.text,fontFamily:"inherit"}}
                            />
                            {customRequests[section.id]?.trim() && selections[section.id] && (
                              <div style={{fontSize:12,color:tk.red,marginTop:6}}>You have both a list selection and a custom request. Only your custom request will be used — or clear the text above to use your list selection instead.</div>
                            )}
                            {customRequests[section.id]?.trim() && !selections[section.id] && (
                              <div style={{fontSize:12,color:tk.green,marginTop:6}}>✓ Custom request noted</div>
                            )}
                          </div>
                        )}
                      </>}
                    </div>
                  );
                })
              )}

              <div style={{display:"flex",justifyContent:"space-between",gap:12,marginTop:8}}>
                <button onClick={()=>setStep(1)} style={{background:"none",border:`1.5px solid ${tk.borderStrong}`,color:tk.text,borderRadius:12,padding:"12px 24px",fontSize:14,fontWeight:500,cursor:"pointer",fontFamily:"inherit"}}>← Back</button>
                <button onClick={()=>setStep(3)} disabled={!selectionsValid}
                  style={{background:selectionsValid?`linear-gradient(135deg,${tk.accent},${tk.accentDark})`:"#ccc",color:"#fff",border:"none",borderRadius:12,padding:"12px 32px",fontSize:15,fontWeight:600,cursor:selectionsValid?"pointer":"not-allowed",fontFamily:"inherit",transition:"all 0.15s"}}>
                  Review My Selections →
                </button>
              </div>
              {!selectionsValid && (
                <div style={{textAlign:"center",fontSize:12,color:tk.textMuted,marginTop:10}}>
                  Please select at least one pre-ceremony song, one post-ceremony song, and one song for each processional and recessional to continue.
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Review ── */}
          {step === 3 && (
            <div className="fade-up">
              <h2 style={{fontFamily:"'SF Pro Display',-apple-system,'DM Sans',sans-serif",fontSize:isMobile?26:34,fontWeight:500,color:tk.text,marginBottom:6}}>Review your selections</h2>
              <p style={{fontSize:14,color:tk.textSub,marginBottom:28,lineHeight:1.6}}>Everything look perfect? Submit your selections and {VIOLINIST_NAME} will be in touch to confirm.</p>
              <div style={{background:tk.surface,borderRadius:16,padding:"20px 24px",border:`1px solid ${tk.border}`,boxShadow:tk.shadowSm,marginBottom:20}}>
                <div style={{fontSize:12,fontWeight:600,color:tk.textSub,textTransform:"uppercase",letterSpacing:0.5,marginBottom:14}}>Your Details</div>
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:10}}>
                  {[{l:"Name",v:clientName},{l:"Partner",v:partnerName||"—"},{l:"Wedding Date",v:weddingDate},{l:"Email",v:clientEmail}].map((r,i)=>(
                    <div key={i} style={{display:"flex",gap:8}}>
                      <span style={{fontSize:12,color:tk.textSub,minWidth:80}}>{r.l}</span>
                      <span style={{fontSize:13,fontWeight:500,color:tk.text}}>{r.v}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{background:tk.surface,borderRadius:16,padding:"20px 24px",border:`1px solid ${tk.border}`,boxShadow:tk.shadowSm,marginBottom:28}}>
                <div style={{fontSize:12,fontWeight:600,color:tk.textSub,textTransform:"uppercase",letterSpacing:0.5,marginBottom:16}}>Song Selections</div>
                {visibleSections.map(section => {
                  const totalSecs = sectionTime(section.id);
                  const getSongName = (id) => { const s = songs.find(x=>x.id===id); return s ? `${s.title} — ${s.artist}` : null; };
                  const ids = section.multi ? (selections[section.id]||[]) : (selections[section.id]?[selections[section.id]]:[]);
                  const customReq = section.allowCustom ? customRequests[section.id]?.trim() : null;
                  return (
                    <div key={section.id} style={{marginBottom:16,paddingBottom:16,borderBottom:`1px solid ${tk.border}`}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <div style={{fontSize:13,fontWeight:600,color:tk.text}}>{section.label}</div>
                        {section.multi && totalSecs>0 && <div style={{fontSize:11,color:tk.textSub}}>{formatMins(totalSecs)}</div>}
                      </div>
                      {customReq && !selections[section.id]
                        ? <div style={{fontSize:13,color:tk.accentDark,marginBottom:3,fontStyle:"italic"}}>Custom request: "{customReq}"</div>
                        : ids.length === 0
                          ? <div style={{fontSize:13,color:tk.textMuted,fontStyle:"italic"}}>No selection</div>
                          : ids.map(id => <div key={id} style={{fontSize:13,color:tk.textSub,marginBottom:3}}>• {getSongName(id)}</div>)
                      }
                    </div>
                  );
                })}
              </div>
              <div style={{background:tk.accent+"0d",border:`1px solid ${tk.accent}25`,borderRadius:12,padding:"14px 18px",marginBottom:24}}>
                <div style={{fontSize:13,color:tk.textSub,lineHeight:1.6}}>
                  <strong style={{color:tk.accentDark}}>Reminder:</strong> All songs will be performed as live violin covers by {VIOLINIST_NAME}. The audio previews in this form are reference recordings only and are not representative of your wedding performance.
                </div>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",gap:12}}>
                <button onClick={()=>setStep(2)} style={{background:"none",border:`1.5px solid ${tk.borderStrong}`,color:tk.text,borderRadius:12,padding:"12px 24px",fontSize:14,fontWeight:500,cursor:"pointer",fontFamily:"inherit"}}>← Edit Selections</button>
                <button onClick={handleSubmit} disabled={submitting}
                  style={{background:`linear-gradient(135deg,${tk.accent},${tk.accentDark})`,color:"#fff",border:"none",borderRadius:12,padding:"12px 36px",fontSize:15,fontWeight:600,cursor:submitting?"wait":"pointer",fontFamily:"inherit",boxShadow:`0 4px 16px ${tk.accent}44`,opacity:submitting?0.7:1}}>
                  {submitting?"Submitting…":"Submit My Selections ✓"}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Thank you ── */}
          {step === 4 && (
            <div style={{textAlign:"center",maxWidth:520,margin:"0 auto",paddingTop:20}} className="fade-up">
              <div style={{width:64,height:2,background:`linear-gradient(90deg,${tk.accent},${tk.accent2})`,margin:"0 auto 32px",borderRadius:1}}/>
              <h2 style={{fontFamily:"'SF Pro Display',-apple-system,'DM Sans',sans-serif",fontSize:isMobile?28:36,fontWeight:700,color:tk.text,letterSpacing:-0.5,marginBottom:16,lineHeight:1.15}}>Thank you, {clientName.split(" ")[0]}!</h2>
              <p style={{fontSize:16,color:tk.textSub,lineHeight:1.7,marginBottom:16}}>Your song selections have been submitted. {VIOLINIST_NAME} will review your choices and be in touch at <strong>{clientEmail}</strong> to confirm everything.</p>
              <p style={{fontSize:14,color:tk.textMuted,lineHeight:1.6,marginBottom:32}}>We can't wait to make your wedding day truly unforgettable.</p>
              <div style={{background:tk.accent+"10",borderRadius:14,padding:"16px 20px",border:`1px solid ${tk.accent}25`}}>
                <div style={{fontSize:13,color:tk.accentDark,fontWeight:500}}>A reminder about your music</div>
                <div style={{fontSize:13,color:tk.textSub,marginTop:4,lineHeight:1.6}}>All selected songs will be performed as live violin covers. The audio previews were reference recordings only.</div>
              </div>
            </div>
          )}
        </main>

        <footer style={{borderTop:`1px solid ${tk.border}`,padding:"20px 24px",textAlign:"center"}}>
          <div style={{fontSize:12,color:tk.textMuted}}>
            {VIOLINIST_NAME} • Wedding Violin •{" "}
            <a href={`mailto:${VIOLINIST_EMAIL}`} style={{color:tk.accent,textDecoration:"none"}}>{VIOLINIST_EMAIL}</a>
          </div>
        </footer>

        {/* ── Persistent YouTube player div (invisible, audio only) ── */}
        <div style={{position:"fixed",left:"-9999px",top:"-9999px",width:1,height:1,overflow:"hidden"}} aria-hidden="true">
          <div ref={playerRef}/>
        </div>

        {/* ── Now playing indicator ── */}
        {playingId && playingYtId && (
          <div style={{position:"fixed",bottom:isMobile?16:24,right:isMobile?16:24,zIndex:999,background:tk.surface,borderRadius:14,boxShadow:"0 8px 40px rgba(0,0,0,0.18)",border:`1px solid ${tk.border}`,overflow:"hidden",width:isMobile?280:320}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:tk.accent,gap:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                <div style={{display:"flex",gap:2,alignItems:"flex-end",height:14,flexShrink:0}}>
                  {[0,1,2,3].map(i=>(
                    <div key={i} style={{width:3,borderRadius:2,background:"rgba(255,255,255,0.9)",animation:`audioBar${i} 0.8s ${i*0.15}s ease-in-out infinite alternate`,height:[8,14,6,11][i]}}/>
                  ))}
                </div>
                <div style={{minWidth:0,textAlign:"left"}}>
                  <div style={{fontSize:12,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"left"}}>{playingSong?.title}</div>
                  <div style={{fontSize:10,color:"rgba(255,255,255,0.7)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"left"}}>{playingSong?.artist}</div>
                </div>
              </div>
              <button onClick={()=>setPlayingId(null)}
                style={{flexShrink:0,background:"rgba(255,255,255,0.2)",border:"none",color:"#fff",width:26,height:26,borderRadius:"50%",cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit",WebkitTapHighlightColor:"transparent"}}>
                ✕
              </button>
            </div>
            <div style={{padding:"8px 14px",background:tk.surface2}}>
              <div style={{fontSize:11,color:tk.textMuted,fontStyle:"italic",textAlign:"center"}}>Reference recording only — live violin performance at your wedding</div>
            </div>
          </div>
        )}

      </div>
    </>
  );
}

// ── Standalone form field ──────────────────────────────────────────────────
function FormField({ label, value, onChange, placeholder, type="text", required, tk, isMobile }) {
  return (
    <div style={{minWidth:0,width:"100%"}}>
      <label style={{display:"block",fontSize:12,fontWeight:600,color:tk.textSub,marginBottom:6,textTransform:"uppercase",letterSpacing:0.4}}>{label}{required?" *":""}</label>
      <input
        type={type}
        value={value}
        onChange={e=>onChange(e.target.value)}
        placeholder={placeholder}
        style={{display:"block",width:"100%",minWidth:0,maxWidth:"100%",padding:isMobile?"11px 13px":"9px 12px",border:`1px solid ${tk.borderStrong}`,borderRadius:10,fontSize:16,background:tk.surface,color:tk.text,fontFamily:"inherit",boxSizing:"border-box",WebkitAppearance:"none",appearance:"none",height:isMobile?"46px":"38px",lineHeight:"normal"}}
      />
    </div>
  );
}
