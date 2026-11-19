import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setApiUser } from '../api'
import { useApp } from '../App'
import { useT } from '../strings'

/* Each step says who to act as, where to go and what to press. "Take me there" does the switching. */
const STEPS = [
  { who: 'DM', to: '/',
    en: ['The District Magistrate starts here', 'Four numbers, then the works with problems: each says what is wrong and who acts next, with the district map beside it. Tap a block to see only its works. Below: "Needs your decision today", hold-ups and surprise inspections.'],
    hi: ['जिलाधिकारी यहाँ से शुरू करते हैं', 'चार संख्याएँ, फिर समस्या वाले कार्य: हर कार्य में क्या गलत है और अगला कदम किसका, साथ में जिले का नक्शा। एक प्रखंड दबाकर केवल उसके कार्य देखें। नीचे: "आज आपका निर्णय चाहिए", बाधाएँ और औचक निरीक्षण।'] },
  { who: 'DM', to: 'GOG-R-014',
    en: ['A road that looks complete but is not', 'Four numbers and one sentence: "Reported 100% done, but the engineer has checked only 75%." Below, "Can it be certified usable?" answers "Not yet" in a few plain lines. The system will not let anyone certify until these are done.'],
    hi: ['पूरी दिखती सड़क, जो पूरी नहीं है', 'चार संख्याएँ और एक वाक्य: "100% काम पूरा बताया गया, पर अभियंता ने केवल 75% जाँचा है।" नीचे "क्या इसे उपयोग योग्य प्रमाणित किया जा सकता है?" कुछ सरल पंक्तियों में "अभी नहीं" बताता है। ये पूरे होने तक कोई प्रमाणित नहीं कर सकता।'] },
  { who: 'Ravi', to: '/',
    en: ["This is all a Junior Engineer sees", "Only his own tasks, most urgent first, in plain words. Open 'Record the required tests', expand 'Side drains' and record the cube test as 17.5 (minimum 20). A verified defect is raised for the EE by itself."],
    hi: ['कनीय अभियंता को बस इतना दिखता है', "केवल उनके अपने काम, ज़रूरी पहले, सरल शब्दों में। 'आवश्यक परीक्षण दर्ज करें' खोलें, 'किनारे की नालियाँ' में क्यूब परीक्षण 17.5 दर्ज करें (न्यूनतम 20)। सिस्टम खुद कार्यपालक अभियंता के लिए दोष दर्ज कर देगा।"] },
  { who: 'Anjali', to: '/',
    en: ['The Assistant Engineer’s list', "Open 'Check-measure before the next payment' and press Check-measure on each unchecked entry. The unchecked-bill warning clears once every paid entry is checked."],
    hi: ['सहायक अभियंता की सूची', "'अगले भुगतान से पहले जाँच-माप करें' खोलें और हर बिना जाँच वाली प्रविष्टि पर 'जाँच-माप करें' दबाएँ। सब जाँचने पर बिल वाली चेतावनी हट जाती है।"] },
  { who: 'Irfan', to: '/',
    en: ['After completion, the work is still watched', "Alauli–Sahsi road was certified last year. Its post-monsoon re-check is late, and 3 of 12 residents say it is not usable. Open 'Do the post-monsoon re-check' and record what you find."],
    hi: ['पूरा होने के बाद भी निगरानी', "अलौली–सहसी सड़क पिछले साल प्रमाणित हुई। मानसून बाद की जाँच देर से है, और 12 में से 3 निवासी कहते हैं उपयोग योग्य नहीं। 'मानसून बाद की पुनः जाँच करें' खोलें और जो मिले दर्ज करें।"] },
  { who: 'Verma', to: '/',
    en: ['When something is ignored, it climbs', "The Circle Officer's land dispute is 16 days overdue, so it now sits with the Deputy Development Commissioner. Open it and press 'Record decision and new deadline': the instruction, the new date and who gave it go on record, and the escalation resets."],
    hi: ['अनदेखा मामला ऊपर पहुँचता है', "अंचल अधिकारी का भूमि विवाद 16 दिन से लंबित है, इसलिए अब उप विकास आयुक्त के पास है। इसे खोलें और 'निर्णय और नई समय-सीमा दर्ज करें' दबाएँ: निर्देश, नई तिथि और किसने दिया, सब रिकॉर्ड में जाता है।"] },
  { who: 'resident', to: '/public',
    en: ['A resident reports a problem', "Three big choices. Tap 'Report a problem', pick Gogri, then the Gogri Bazaar – Rampur road. Choose a problem type. If yours is already reported, join it with one tap; otherwise speak or type."],
    hi: ['निवासी समस्या बताते हैं', "तीन बड़े विकल्प। 'किसी काम में समस्या बताएँ' दबाएँ, गोगरी चुनें, फिर गोगरी बाज़ार – रामपुर सड़क। समस्या का प्रकार चुनें। अगर पहले से दर्ज है, एक टैप में जुड़ें; नहीं तो बोलकर या लिखकर बताएँ।"] },
  { who: 'Ravi', to: '/',
    en: ['The report lands on the Junior Engineer’s list', "Open 'Acknowledge a resident report' and press Acknowledge. The resident gets an SMS."],
    hi: ['शिकायत कनीय अभियंता की सूची में आती है', "'निवासी की शिकायत स्वीकार करें' खोलें और 'स्वीकार करें' दबाएँ। निवासी को SMS जाता है।"] },
  { who: 'Anjali', to: '/',
    en: ['Assistant Engineer examines it', "Open 'Examine on site'. Press Start examination, then Record verified defect with a photo and your finding. A resident's photo alone is not accepted as proof."],
    hi: ['सहायक अभियंता जाँच करती हैं', "'स्थल पर जाँच करें' खोलें। 'जाँच शुरू करें', फिर फोटो और निष्कर्ष के साथ 'सत्यापित दोष दर्ज करें'। केवल निवासी की फोटो प्रमाण नहीं मानी जाती।"] },
  { who: 'Suresh', to: '/',
    en: ['Executive Engineer assigns the repair', "Open 'Assign the repair', choose M/s Kosi Infra and a date."],
    hi: ['कार्यपालक अभियंता मरम्मत सौंपते हैं', "'मरम्मत सौंपें' खोलें, M/s Kosi Infra और तिथि चुनें।"] },
  { who: 'Kosi', to: '/',
    en: ['The contractor sees only their repairs', "Open 'Fix and report the repair' for this report and attach a photo."],
    hi: ['संवेदक को केवल अपनी मरम्मत दिखती है', "'मरम्मत कर सूचना दें' खोलें और फोटो लगाएँ।"] },
  { who: 'Kosi', to: 'GOG-R-014',
    en: ['What the contractor does not see', "On his own road he sees progress, failed tests and the repairs given to him. Residents' names and phone numbers, reports still being checked, and the photo and bill checks stay with the engineers. Works of other contractors do not open for him at all."],
    hi: ['संवेदक को क्या नहीं दिखता', 'अपनी सड़क पर उन्हें प्रगति, फेल परीक्षण और सौंपी गई मरम्मत दिखती है। निवासियों के नाम-फ़ोन, जाँच में चल रही शिकायतें और फोटो-बिल की जाँच अभियंताओं के पास रहती हैं। दूसरे संवेदकों के कार्य उनके लिए खुलते ही नहीं।'] },
  { who: 'Anjali', to: '/',
    en: ['An independent re-inspection closes it', "Open 'Re-inspect the repair on site'. Closing needs a fresh photo you took after the repair: the contractor's photo, the same file again, or someone else's photo is refused. If it is not fixed, send it back for rework instead."],
    hi: ['स्वतंत्र पुनः जाँच से ही बंद', "'मरम्मत की स्थल पर पुनः जाँच करें' खोलें। बंद करने के लिए मरम्मत के बाद आपकी खुद की नई फोटो चाहिए: संवेदक की फोटो, वही फ़ाइल दोबारा, या किसी और की फोटो नहीं चलेगी। ठीक न हो तो दोबारा काम के लिए लौटाएँ।"] },
  { who: 'resident', to: 'track',
    en: ['The resident sees every step', 'Tracking needs the report number and the private code from the SMS, so nobody can read another person\'s report by guessing numbers. If a closure looks wrong, the resident can appeal once from here; a different officer must examine it.'],
    hi: ['निवासी हर कदम देखते हैं', 'ट्रैकिंग के लिए शिकायत संख्या और SMS में आया निजी कोड चाहिए, ताकि कोई संख्या अंदाज़ कर दूसरे की शिकायत न पढ़ सके। बंद करना गलत लगे तो निवासी यहीं से अपील कर सकते हैं; कोई दूसरा अधिकारी जाँच करेगा।'] },
]

export default function DemoGuide() {
  const { meta, setUserId, lastTicket } = useApp()
  const { L, lang } = useT()
  const nav = useNavigate()
  const [open, setOpen] = useState(true)
  const [i, setI] = useState(0)
  const [busy, setBusy] = useState(false)
  const step = STEPS[i]
  const [title, text] = step[lang]

  async function go(k = i) {
    const s = STEPS[k]
    setBusy(true)
    try {
      if (s.who !== 'resident') {
        const o = s.who === 'DM' ? meta.officers.find(x => x.role === 'DM') : meta.officers.find(x => x.name.includes(s.who))
        setUserId(o.id)
        setApiUser(o.id)  // so the lookup below runs as this person straight away
      }
      let path = s.to
      if (/^[A-Z]{3}-/.test(s.to)) {
        const d = await api.get('/dashboard')
        path = `/works/${d.works.find(w => w.code === s.to).id}`
      }
      if (s.to === 'track') path = lastTicket ? `/track/${lastTicket.ticket}?k=${encodeURIComponent(lastTicket.key)}` : '/track'
      nav(path)
    } finally { setBusy(false) }
  }

  const who = step.who === 'resident' ? L.aResident : step.who === 'DM' ? L.theDM
    : meta.officers.find(x => x.name.includes(step.who))?.name.replace('Er. ', '')

  if (!open) return <button className="guide-fab" onClick={() => setOpen(true)}>{L.guide}: {L.step(i + 1, STEPS.length)}</button>

  return (
    <aside className="guide" aria-label={L.guide}>
      <div className="guide-in">
        <div className="guide-body">
          <div className="guide-h">
            <span>{L.guide}, {L.step(i + 1, STEPS.length)}</span>
            <span className="guide-progress" aria-hidden="true"><span style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} /></span>
            <button className="guide-x" onClick={() => setOpen(false)}>{L.hide}</button>
          </div>
          <h3>{title} <span className="guide-who">{lang === 'hi' ? `(${who})` : `Acting as ${who}`}</span></h3>
          <p className="guide-text">{text}{step.to === 'track' && lastTicket ? L.yourTicket(lastTicket.ticket) : null}</p>
        </div>
        <div className="guide-btns">
          <button className="btn secondary" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>{L.back}</button>
          <button className="btn secondary" onClick={() => go()} disabled={busy}>{L.takeMe}</button>
          <button className="btn" onClick={() => { const k = Math.min(STEPS.length - 1, i + 1); setI(k); go(k) }} disabled={i === STEPS.length - 1}>{L.nextStep}</button>
        </div>
      </div>
    </aside>
  )
}
