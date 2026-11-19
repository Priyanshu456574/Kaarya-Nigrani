import { createContext, useContext, useState } from 'react'

const T = {
  hi: {
    homeQ: 'आप क्या करना चाहते हैं?', homeSub: 'खगड़िया जिले के सड़क, नाली और भवन जैसे सरकारी निर्माण कार्य',
    optReport: 'किसी काम में समस्या बताएँ', optReportSub: 'सड़क टूटी, नाली नहीं बनी, काम रुका हुआ',
    optTrack: 'अपनी शिकायत की स्थिति देखें', optTrackSub: 'शिकायत संख्या से', optBrowse: 'मेरे प्रखंड के काम देखें', optBrowseSub: 'कौन सा काम कहाँ तक पहुँचा',
    noPhone: 'स्मार्टफोन नहीं है?', noPhoneMissed: 'मिस्ड कॉल दें, अधिकारी वापस फोन करेंगे', noPhoneWa: 'व्हाट्सऐप पर "खगड़िया" लिखकर भेजें',
    noPhonePanchayat: 'पंचायत भवन पर विकास मित्र या पंचायत सचिव आपकी शिकायत दर्ज करा देंगे', pilotNo: '(नंबर पायलट में दिया जाएगा)',
    pickBlock: 'अपना प्रखंड चुनें', worksIn: (b) => `${b} प्रखंड के कार्य`, onMap: 'नक्शे पर देखें', hideMap: 'नक्शा छिपाएँ', pickWork: 'जिस काम में समस्या है, उसे चुनें',
    statusLine: { SANCTIONED: (d) => `काम अभी शुरू नहीं हुआ। ${d} तक पूरा होना है।`, IN_PROGRESS: (p, d) => `काम चल रहा है। ${p}% हुआ। ${d} तक पूरा होना है।`, REPORTED_COMPLETE: () => 'ठेकेदार ने काम पूरा बताया है। अभियंता की जाँच बाकी है।', USABLE_VERIFIED: () => 'जाँच के बाद यह काम उपयोग योग्य प्रमाणित है।' },
    extendedNote: 'समय बढ़ाया गया', usableQ: 'क्या यह काम आपके उपयोग में आ रहा है?', yes: 'हाँ', noProblem: 'नहीं, समस्या है', thanksVote: 'धन्यवाद! आपकी राय दर्ज हो गई।',
    stepN: (i, n) => `चरण ${i} / ${n}`, s1: 'क्या समस्या है?',
    s2: 'क्या आपकी समस्या इनमें से कोई है?', s2Sub: 'अगर किसी ने पहले ही यही बताया है, तो उसी में जुड़ें। इससे जल्दी कार्रवाई होती है।',
    sameYes: 'हाँ, यही समस्या है', sameNo: 'नहीं, मेरी समस्या अलग है', othersToo: (n) => `${n} और लोगों ने भी यही बताया`,
    s3: 'हमें बताएँ', speak: 'बोलकर बताएँ', speakSub: 'फोन पर आवाज़ रिकॉर्ड करें', recorded: 'आवाज़ रिकॉर्ड हो गई', orType: 'या लिखकर बताएँ',
    addPhoto: 'फोटो लगाएँ (ज़रूरी नहीं)', smsQ: 'SMS से जानकारी चाहिए? मोबाइल नंबर लिखें (ज़रूरी नहीं)', smsWhy: 'नंबर केवल अधिकारी देखेंगे, किसी और को नहीं दिखेगा।',
    next: 'आगे', backBtn: 'पीछे', needOne: 'समस्या लिखें या आवाज़ रिकॉर्ड करें।',
    joined: 'आप इस शिकायत से जुड़ गए', smsSent: 'आपके फ़ोन पर भेजा गया SMS (डेमो)', whatNext: 'आगे क्या होगा',
    nextSteps: ['3 दिन में कनीय अभियंता शिकायत देखेंगे', 'स्थल पर तकनीकी जाँच होगी', 'समस्या सही मिली तो मरम्मत तय समय में होगी'],
    smsUpdates: 'SMS से भेजी गई जानकारी', home: 'मुख्य पेज',
    site: 'कार्य निगरानी', sub: 'खगड़िया जिला के सार्वजनिक निर्माण कार्य', lang: 'English',
    findTitle: 'अपने इलाके का कार्य खोजें', findHint: 'साइट बोर्ड पर लगा QR कोड स्कैन करें, या नीचे खोजें।',
    search: 'गाँव, प्रखंड या कार्य का नाम', trackLink: 'अपनी शिकायत की स्थिति देखें',
    block: 'प्रखंड', dept: 'विभाग', cost: 'स्वीकृत राशि', due: 'पूरा होने की तिथि', progress: 'काम कितना हुआ', status: 'स्थिति',
    report: 'समस्या बताएँ', reportTitle: 'इस कार्य में क्या समस्या है?',
    cat: { quality: 'घटिया काम / टूट-फूट', usability: 'काम अधूरा / उपयोग नहीं हो पा रहा', safety: 'खतरा / दुर्घटना का डर', delay: 'काम रुका हुआ है' },
    desc: 'समस्या लिखें', descPh: 'जैसे: बारिश में पानी भर जाता है, नाली नहीं बनी',
    photo: 'फोटो (वैकल्पिक)', name: 'आपका नाम (वैकल्पिक)', phone: 'मोबाइल नंबर (वैकल्पिक, केवल अधिकारी देखेंगे)',
    send: 'शिकायत भेजें', sending: 'भेजा जा रहा है…', cancel: 'रद्द करें',
    received: 'आपकी शिकायत दर्ज हो गई', keep: 'शिकायत संख्या और ट्रैकिंग कोड संभाल कर रखें। दोनों से ही स्थिति दिखेगी; कोड किसी को न बताएँ।', track: 'स्थिति देखें', trackCode: 'ट्रैकिंग कोड', codePh: 'SMS में आया कोड',
    joinedNote: 'हर कदम पर आपको SMS मिलेगा।', appealTitle: 'क्या समस्या अब भी है?', appealSub: 'अगर बंद करने का निर्णय गलत लगता है, तो बताएँ। कोई दूसरा अधिकारी दोबारा जाँच करेगा।',
    appealPh: 'क्या अब भी गलत है, एक-दो वाक्य में', appealBtn: 'दोबारा जाँच की माँग करें', appealed: 'आपकी अपील दर्ज हो गई। कोई दूसरा अधिकारी जाँच करेगा।',
    independent: 'मरम्मत की जाँच उस व्यक्ति से अलग अधिकारी ने स्थल पर जाकर की, जिसने मरम्मत की थी।', checkedM: (n) => `जाँच-माप हुआ: ${n}%`,
    reports: 'निवासियों की शिकायतें', noReports: 'अभी तक कोई शिकायत नहीं।',
    unverified: 'जाँच बाकी है', verified: 'अभियंता द्वारा जाँच में सही पाई गई', closed: 'ठीक कराकर जाँच के बाद बंद', notsub: 'जाँच में पुष्टि नहीं हुई',
    legend: 'पीली धारीदार पट्टी: शिकायत, जाँच बाकी। लाल: अभियंता ने जाँच में समस्या पाई। हरी: ठीक हुई और जाँची गई।',
    ticket: 'शिकायत संख्या', trackTitle: 'शिकायत की स्थिति', go: 'देखें', notfound: 'यह शिकायत नहीं मिली। शिकायत संख्या और ट्रैकिंग कोड दोबारा जाँचें।',
    nextBy: 'अगली कार्रवाई', history: 'अब तक क्या हुआ', finding: 'जाँच का निष्कर्ष',
    stages: 'काम के चरण', back: 'सभी कार्य',
    step: { REPORTED: 'शिकायत दर्ज हुई (जाँच बाकी)', ACKNOWLEDGED: 'शिकायत स्वीकार की गई', UNDER_EXAMINATION: 'तकनीकी जाँच शुरू', VERIFIED: 'अभियंता ने जाँच में समस्या सही पाई', NOT_SUBSTANTIATED: 'जाँच में समस्या की पुष्टि नहीं हुई', ACTION_ASSIGNED: 'सुधार का काम सौंपा गया', RECTIFIED: 'सुधार की सूचना, दूसरे अधिकारी की जाँच बाकी', CLOSED: 'दूसरे अधिकारी ने स्थल पर जाँच कर बंद किया', APPEALED: 'आपकी अपील पर फिर खोला गया' },
    wstatus: { SANCTIONED: 'शुरू नहीं हुआ', IN_PROGRESS: 'काम चल रहा है', REPORTED_COMPLETE: 'पूरा बताया गया, जाँच बाकी', USABLE_VERIFIED: 'जाँच के बाद उपयोग योग्य' },
  },
  en: {
    homeQ: 'What would you like to do?', homeSub: 'Government construction works in Khagaria district: roads, drains and buildings',
    optReport: 'Report a problem with a work', optReportSub: 'Broken road, drain not built, work stopped',
    optTrack: 'Check the status of my report', optTrackSub: 'Using your report number', optBrowse: 'See works in my block', optBrowseSub: 'How far each work has reached',
    noPhone: 'No smartphone?', noPhoneMissed: 'Give a missed call and an officer will call you back', noPhoneWa: 'Send "KHAGARIA" on WhatsApp',
    noPhonePanchayat: 'At the Panchayat Bhawan, the Vikas Mitra or Panchayat Secretary can file your report for you', pilotNo: '(number to be given in the pilot)',
    pickBlock: 'Choose your block', worksIn: (b) => `Works in ${b} block`, onMap: 'Show on map', hideMap: 'Hide map', pickWork: 'Choose the work that has the problem',
    statusLine: { SANCTIONED: (d) => `Work has not started yet. Due by ${d}.`, IN_PROGRESS: (p, d) => `Work is going on. ${p}% done. Due by ${d}.`, REPORTED_COMPLETE: () => 'The contractor says the work is complete. The engineer has not checked it yet.', USABLE_VERIFIED: () => 'Checked by the engineer and certified usable.' },
    extendedNote: 'time extended', usableQ: 'Is this work useful to you?', yes: 'Yes', noProblem: 'No, there is a problem', thanksVote: 'Thank you. Your answer has been recorded.',
    stepN: (i, n) => `Step ${i} of ${n}`, s1: 'What is the problem?',
    s2: 'Is your problem one of these?', s2Sub: 'If someone has already reported it, join that report. More voices get faster action.',
    sameYes: 'Yes, this is my problem', sameNo: 'No, my problem is different', othersToo: (n) => `${n} more people reported this too`,
    s3: 'Tell us', speak: 'Speak instead', speakSub: 'Record your voice on the phone', recorded: 'Voice recorded', orType: 'or type it',
    addPhoto: 'Add a photo (optional)', smsQ: 'Want updates by SMS? Mobile number (optional)', smsWhy: 'Only officers can see your number. It is never shown to anyone else.',
    next: 'Next', backBtn: 'Back', needOne: 'Write the problem or record a voice note.',
    joined: 'You have joined this report', smsSent: 'SMS sent to your phone (demo)', whatNext: 'What happens next',
    nextSteps: ['The Junior Engineer will look at it within 3 days', 'A technical check on site', 'If the problem is confirmed, a repair with a fixed date'],
    smsUpdates: 'Updates sent by SMS', home: 'Home',
    site: 'Kaarya Nigrani', sub: 'Public works in Khagaria district', lang: 'हिंदी',
    findTitle: 'Find a work near you', findHint: 'Scan the QR code on the site board, or search below.',
    search: 'Village, block or work name', trackLink: 'Check the status of your report',
    block: 'Block', dept: 'Department', cost: 'Sanctioned', due: 'Due by', progress: 'Work done', status: 'Status',
    report: 'Report a problem', reportTitle: 'What is wrong with this work?',
    cat: { quality: 'Poor quality / damage', usability: 'Unfinished / cannot be used', safety: 'Unsafe / risk of accident', delay: 'Work has stopped' },
    desc: 'Describe the problem', descPh: 'e.g. Water collects after rain, the drain was not built',
    photo: 'Photo (optional)', name: 'Your name (optional)', phone: 'Mobile number (optional, seen only by officers)',
    send: 'Send report', sending: 'Sending…', cancel: 'Cancel',
    received: 'Your report has been received', keep: 'Keep the report number and the tracking code. You need both to see progress; do not share the code.', track: 'Check status', trackCode: 'Tracking code', codePh: 'Code from your SMS',
    joinedNote: 'You will get an SMS at every step.', appealTitle: 'Is the problem still there?', appealSub: 'If the decision to close this looks wrong, tell us. A different officer will examine it again.',
    appealPh: 'What is still wrong, in a sentence or two', appealBtn: 'Ask for a fresh check', appealed: 'Your appeal is registered. A different officer will examine it.',
    independent: 'The repair was checked on site by an officer other than the one who reported it fixed.', checkedM: (n) => `Check-measured: ${n}%`,
    reports: 'Reports from residents', noReports: 'No reports yet.',
    unverified: 'Awaiting technical check', verified: 'Confirmed by engineer', closed: 'Fixed and checked', notsub: 'Not confirmed on inspection',
    legend: 'Dashed yellow: reported, not yet checked. Red: an engineer confirmed the problem. Green: fixed and checked.',
    ticket: 'Report number', trackTitle: 'Report status', go: 'Check', notfound: 'No report found. Check the report number and the tracking code.',
    nextBy: 'Next action by', history: 'What has happened', finding: 'Inspection finding',
    stages: 'Stages of work', back: 'All works',
    step: { REPORTED: 'Report received (not yet checked)', ACKNOWLEDGED: 'Acknowledged', UNDER_EXAMINATION: 'Technical examination started', VERIFIED: 'Engineer confirmed the problem', NOT_SUBSTANTIATED: 'Not confirmed on inspection', ACTION_ASSIGNED: 'Repair assigned', RECTIFIED: 'Repair reported, awaiting a check by another officer', CLOSED: 'Checked on site by another officer and closed', APPEALED: 'Reopened on your appeal' },
    wstatus: { SANCTIONED: 'Not started', IN_PROGRESS: 'In progress', REPORTED_COMPLETE: 'Reported complete, awaiting check', USABLE_VERIFIED: 'Checked and usable' },
  },
}

export const ROLE = {
  hi: { JE: 'कनीय अभियंता', AE: 'सहायक अभियंता', EE: 'कार्यपालक अभियंता', CONTRACTOR: 'संवेदक', CO: 'अंचल अधिकारी', BDO: 'प्रखंड विकास पदाधिकारी', DM: 'जिलाधिकारी', DDC: 'उप विकास आयुक्त', Resident: 'निवासी' },
  en: { JE: 'Junior Engineer', AE: 'Assistant Engineer', EE: 'Executive Engineer', CONTRACTOR: 'Contractor', CO: 'Circle Officer', BDO: 'Block Development Officer', DM: 'District Magistrate', DDC: 'Deputy Development Commissioner', Resident: 'Resident' },
}

export const LangContext = createContext({ lang: 'hi', setLang: () => {} })

/** One language setting for the whole app. Residents default to Hindi, officers to English, until someone chooses. */
export function useLangState(isPublic) {
  // Default is decided once, by the first screen opened (resident pages: Hindi; officer pages: English), then stays put.
  const [chosen, setChosen] = useState(() => { try { return localStorage.getItem('kn-lang') || (isPublic ? 'hi' : 'en') } catch { return isPublic ? 'hi' : 'en' } })
  const lang = chosen
  const setLang = (l) => { setChosen(l); try { localStorage.setItem('kn-lang', l) } catch { /* storage unavailable */ } }
  return { lang, setLang }
}

export function useLang() {
  const { lang, setLang } = useContext(LangContext)
  return { lang, t: T[lang], role: ROLE[lang], toggle: () => setLang(lang === 'hi' ? 'en' : 'hi'), setLang }
}

export function publicStatus(issue, t) {
  if (issue.status === 'CLOSED') return { cls: 'done', text: t.closed }
  if (issue.status === 'NOT_SUBSTANTIATED') return { cls: 'neutral', text: t.notsub }
  if (issue.verified) return { cls: 'defect', text: t.verified }
  return { cls: 'claim', text: t.unverified }
}
