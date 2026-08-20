import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy-initialized GoogleGenAI
let aiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

// System prompt tailored for FemiCare Cameroon & Francophone Africa
const FEMICARE_SYSTEM_PROMPT = `Tu es FemiBot / Dr. Amina, l'assistante intelligente et bienveillante de santé féminine de l'application FemiCare, conçue pour les femmes au Cameroun et en Afrique francophone.
Ton rôle est d'informer, rassurer, guider et expliquer les aspects de la santé féminine :
- Cycle menstruel, règles douloureuses, calcul d'ovulation, SPM.
- Fertilité, désir d'enfant, contraception (pilule, stérilet, implant, préservatifs, pilule du lendemain NorLevo/Postinor).
- Grossesse semaine par semaine, signes d'alerte, Consultations Prénatales (CPN 1 à 8 au Cameroun), nutrition locale (feuilles de manioc, foléré/bissap, fruits de saison, hydratation, prévention du paludisme chez la femme enceinte).
- Hygiène intime (éviter les douches vaginales agressives ou savons parfumés, privilégier l'eau tiède et sous-vêtements en coton).
- IST (dépistage VIH, chlamydia, syphilis, hépatite B) sans tabou ni jugement.
- Ménopause et périménopause.

DIRECTIVES ESSENTIELLES :
1. Climat de confiance, ton respectueux, chaleureux et bienveillant ("chère utilisatrice" ou empathique).
2. Toujours rappeler avec clarté : "Je suis un assistant d'information et d'orientation, je ne remplace pas une consultation médicale avec un médecin ou une sage-femme."
3. En cas de symptômes graves (saignements abondants avec vertiges, retard de règles avec douleur brutale d'un côté évoquant une Grossesse Extra-Utérine, fièvre élevée pendant la grossesse, pertes malodorantes avec douleurs pelviennes intenses), conseiller immédiatement de se rendre aux urgences de la maternité la plus proche (ex: Hôpital Central de Yaoundé, Hôpital Laquintinie de Douala, HGOPY, ou hôpital de district) ou d'appeler le 119/117.
4. Réponds en français clair, accessible et bien structuré avec des puces.
5. Adapte tes conseils aux réalités locales d'Afrique subsaharienne avec des conseils pratiques et sûrs.`;

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "FemiCare", timestamp: new Date().toISOString() });
});

// Chat with FemiCare AI Assistant
app.post("/api/gemini/chat", async (req, res) => {
  try {
    const { messages, userContext } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Format de messages invalide" });
    }

    const ai = getGenAI();
    if (!ai) {
      // Fallback helpful offline mock response if GEMINI_API_KEY is not configured
      return res.json({
        reply: "Bonjour ! Je suis FemiBot, votre compagne santé FemiCare. Pour activer l'analyse personnalisée en temps réel, veuillez renseigner votre clé GEMINI_API_KEY dans les paramètres. En attendant, rappelez-vous qu'une bonne hydratation, une alimentation riche en fer et un suivi régulier de votre calendrier sont vos meilleurs alliés !",
        disclaimer: "FemiCare ne remplace pas l'avis d'un professionnel de santé certifié."
      });
    }

    let contextString = "";
    if (userContext) {
      contextString = `\n[Contexte de l'utilisatrice: Phase actuelle: ${userContext.currentPhase || "Inconnue"}, Jour du cycle: ${userContext.cycleDay || "Non spécifié"}, Grossesse: ${userContext.isPregnant ? `Semaine ${userContext.pregnancyWeek}` : "Non"}, Ville/Région: ${userContext.location || "Cameroun"}]`;
    }

    // Build contents for Gemini 3.7 Flash
    const formattedPrompt = `${FEMICARE_SYSTEM_PROMPT}${contextString}\n\nHistorique de la discussion:\n` +
      messages.map((m: { role: string; content: string }) => `${m.role === 'user' ? 'Utilisatrice' : 'FemiBot'}: ${m.content}`).join("\n") +
      "\nFemiBot:";

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: formattedPrompt,
    });

    const replyText = response.text || "Je suis là pour vous accompagner. N'hésitez pas à me poser toute question sur votre cycle ou votre bien-être.";

    return res.json({
      reply: replyText,
      disclaimer: "FemiCare ne remplace pas un diagnostic médical en présentiel.",
    });
  } catch (error: any) {
    console.error("Gemini Chat Error:", error);
    return res.status(500).json({
      error: "Une erreur est survenue lors de la communication avec l'assistant.",
      details: error?.message || String(error),
      fallback: "En cas d'urgence gynécologique ou de douleurs aiguës, veuillez contacter directement le centre de santé le plus proche ou composer le 119."
    });
  }
});

// Cycle & Symptom Smart Insights
app.post("/api/gemini/insights", async (req, res) => {
  try {
    const { cycleData, symptoms } = req.body;
    const ai = getGenAI();

    if (!ai) {
      return res.json({
        title: "Conseil du Jour FemiCare",
        insights: [
          "Phase lutéale : privilégiez les tisanes de gingembre et l'eau pour réduire les ballonnements.",
          "N'oubliez pas vos apports en magnésium et fer (légumes verts à feuilles, haricots rouges).",
          "Surveillez votre hydratation en période chaude (2 à 2.5L d'eau par jour)."
        ]
      });
    }

    const prompt = `${FEMICARE_SYSTEM_PROMPT}\n\nGénère 3 conseils courts, bienveillants et adaptés à la santé féminine pour une femme au Cameroun selon ces données :
Données du cycle : ${JSON.stringify(cycleData || {})}
Symptômes enregistrés : ${JSON.stringify(symptoms || [])}

Format JSON attendu :
{
  "title": "Titre bienveillant court",
  "insights": ["Conseil 1", "Conseil 2", "Conseil 3"],
  "foodRecommendation": "Aliment local recommandé (ex: Ndolè doux, banane plantain mûre, tisane foléré)",
  "alertLevel": "normal" ou "attention"
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const jsonStr = response.text || "{}";
    const data = JSON.parse(jsonStr);
    return res.json(data);
  } catch (error) {
    console.error("Insights error:", error);
    return res.json({
      title: "Conseil FemiCare",
      insights: [
        "Prenez soin de vous : reposez-vous et buvez de l'eau tiède pour apaiser les crampes.",
        "Consignez vos symptômes quotidiens pour aider votre sage-femme lors de la prochaine visite."
      ],
      foodRecommendation: "Tisane de gingembre ou jus de bissap naturel sans excès de sucre."
    });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`FemiCare server running on http://localhost:${PORT}`);
  });
}

startServer();
