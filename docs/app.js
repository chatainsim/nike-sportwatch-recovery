/* Page logic: read the watch (or a file), list the runs, map, exports. */
(function () {
  "use strict";
  const D = window.NikeDecoder;
  const W = window.NikeWatch;
  const $ = (id) => document.getElementById(id);
  const ISSUES_URL = "https://github.com/chatainsim/nike-sportwatch-recovery/issues";

  // ── Texts ──────────────────────────────────────────────────────────────────

  const T = {
    en: {
      title: "Nike+ SportWatch GPS — get your runs back",
      heroTitle: "Your runs are still on the watch",
      heroLead: "Nike's servers are gone, but the watch kept your runs in memory. Plug it in, read it, and download each run as a GPX file for Strava, Garmin Connect or any mapping app.",
      privacy: "Everything happens in this browser tab: your runs are never uploaded anywhere. Only map backgrounds are downloaded from OpenStreetMap.",
      warnTitle: "Do not connect the watch to Nike+ Connect.",
      warnText: "That software erases the watch after \"uploading\" it to servers that no longer exist. This page only reads.",
      step1: "Put the watch on its USB dock and plug the dock into this computer.",
      step2: "Click the button below, pick “Nike+ SportWatch” in the list, and click “Connect”.",
      step3: "Wait a few seconds while the watch is read (twice, to check the copy).",
      connect: "Connect the watch",
      openFile: "Open a saved file…",
      unsupported: "This browser cannot talk to USB devices. Use Chrome or Edge on a computer — or open a file saved earlier.",
      dropHint: "You can also drop a .packets file (from pull_raw_data_v2.py) anywhere on this page.",
      dropHere: "Drop the file to read it",
      downloadAll: "Download all (.zip)",
      downloadRaw: "Save raw data (.packets)",
      noGps: "No GPS track for this run (GPS was off, or not recovered).",
      paceChart: "Speed during the run",
      faqTitle: "Questions",
      faq1q: "The watch does not appear in the list",
      faq1a: "Check that the dock is plugged in and the watch sits properly on it, then try another USB port. Close Nike+ Connect if it is running: it keeps the watch busy. On Linux, the browser needs permission to access the device (a udev rule for vendor 11ac, product 5455).",
      faq2q: "Which browsers work?",
      faq2a: "Chrome, Edge, Opera and other Chromium-based browsers on a computer (Windows, macOS, Linux). Firefox and Safari do not support talking to USB devices from a web page.",
      faq3q: "The date of a run looks wrong",
      faq3a: "The watch clock can drift or be wrong. For runs with GPS, the date comes from the GPS and is reliable; without GPS, only the watch clock is available.",
      faq4q: "Heart rate and steps are missing",
      faq4a: "Those formats are not decoded yet: no heart-rate strap or foot pod was paired on the watch used to build this tool. If you have runs with them, please get in touch on GitHub.",
      faq5q: "Is it safe for the watch?",
      faq5a: "Yes: the page only sends the command that reads the runs. Nothing is erased or written, and you can read the watch as often as you like.",
      footer1: "Open source project, not affiliated with Nike or TomTom.",
      footer2: "Built with",
      // dynamic
      sConnecting: "Connecting to the watch…",
      sChecking: "Checking the watch memory…",
      sReading: (n, pass) => `Reading the watch (${pass}/2)… ${n} packets`,
      sDecoding: "Decoding…",
      sFile: (name) => `Reading ${name}…`,
      runsFound: (n) => (n === 0 ? "No run found" : n === 1 ? "1 run found" : `${n} runs found`),
      verifyOk: "Read twice, both copies identical: the data is complete.",
      verifyDiff: "The two reads differ: the result may be incomplete. Try reading the watch again.",
      verifyFile: (name) => `Decoded from ${name}.`,
      empty: "The watch memory is empty: there is no run to recover.",
      noRuns: "The data was read, but no run could be decoded from it.",
      eUnsupported: "This browser cannot access USB devices. Open this page in Chrome or Edge on a computer.",
      eCancelled: "No watch selected. Click “Connect the watch” again and pick the watch in the list.",
      eOpen: "The watch was found but could not be opened. Close Nike+ Connect (or any other program using the watch), unplug the dock, plug it back in and try again.",
      eOpenLinux: "On Linux, the browser also needs permission: add a udev rule for vendor 11ac, product 5455.",
      eTimeout: "The watch did not answer. Check that it sits properly on the dock, unplug and replug the dock, then try again.",
      eFile: "This file could not be read. Expected a .packets file (from this page or pull_raw_data_v2.py) or a raw memory .bin.",
      eIncomplete: "The watch sent only part of its memory, even after several requests. Unplug the dock, plug it back in, and try again.",
      eGeneric: "Something went wrong:",
      eHelp: "If it keeps failing, please report it (link below).",
      dist: "Distance", dur: "Duration", pace: "Avg. pace", kcal: "Calories",
      noGpsBadge: "no GPS", incomplete: "end not recorded", watchClock: "date from the watch clock",
      gpx: "GPX", csv: "Speed CSV",
      legend: (max) => `max ${max}`,
      noSpeed: "no speed data",
      eraseTitle: "Empty the watch (experimental)",
      eraseIntro: "Once its memory is full, the watch may stop recording. This erases every run stored on the watch, as Nike+ Connect used to after each sync. It cannot be undone.",
      eraseExperimental: "Experimental: the erase command has not been confirmed on a real watch yet. If the watch refuses it, nothing is lost.",
      eraseStep1: "Download the backup (GPX, CSV and raw data of every run):",
      eraseBackup: "Download the backup (.zip)",
      eraseBackupDone: "Backup downloaded ✓",
      eraseWord: "ERASE",
      eraseConfirm: (w) => `Type ${w} to confirm:`,
      eraseGo: "Empty the watch",
      eraseChecking: "Checking that the watch still holds exactly the backed-up data…",
      eraseChanged: "The watch memory changed since the backup (a new run?). Nothing was erased: read the watch again, then start over.",
      eraseRunning: "Erasing… (up to 30 seconds — do not unplug the watch)",
      eraseVerifying: "Checking: reading the watch again…",
      eraseDone: "Done: the watch is empty. Your runs remain listed on this page and in the backup.",
      eraseFailed: "The watch still holds its runs: it did not erase its memory. Nothing was lost. Please report it (link below) with the technical log.",
      reportLink: "Report the problem: open an issue on the GitHub repository",
      reportHint: "Attach the technical log (“Show technical log”, then Copy or Download).",
      logsIssue: "Open an issue on GitHub",
      footerIssues: "Report a problem",
      logsShow: "Show technical log", logsHide: "Hide technical log",
      logsHelp: "Everything the page sent to and received from the watch. If something goes wrong, attach it to an issue on the GitHub repository. It contains no GPS position.",
      logsCopy: "Copy", logsDownload: "Download (.txt)", logsCopied: "Copied.",
      emptyHint: "If you know the watch holds runs, please report it: open an issue on the GitHub repository (link at the bottom of the page) with the technical log below.",
      seeLogs: "The technical log below (“Show technical log”) tells what happened.",
    },
    fr: {
      title: "Nike+ SportWatch GPS — récupérez vos sorties",
      heroTitle: "Vos sorties sont toujours dans la montre",
      heroLead: "Les serveurs de Nike ont fermé, mais la montre a gardé vos sorties en mémoire. Branchez-la, lisez-la, et téléchargez chaque sortie en GPX pour Strava, Garmin Connect ou n'importe quelle appli de carte.",
      privacy: "Tout se passe dans cet onglet : vos sorties ne sont jamais envoyées nulle part. Seuls les fonds de carte sont téléchargés depuis OpenStreetMap.",
      warnTitle: "Ne branchez pas la montre sur Nike+ Connect.",
      warnText: "Ce logiciel efface la montre après l'avoir « envoyée » vers des serveurs qui n'existent plus. Cette page ne fait que lire.",
      step1: "Posez la montre sur son dock USB et branchez le dock sur cet ordinateur.",
      step2: "Cliquez sur le bouton ci-dessous, choisissez « Nike+ SportWatch » dans la liste, puis « Connexion ».",
      step3: "Patientez quelques secondes pendant la lecture (faite deux fois, pour vérifier la copie).",
      connect: "Connecter la montre",
      openFile: "Ouvrir un fichier enregistré…",
      unsupported: "Ce navigateur ne peut pas communiquer avec les appareils USB. Utilisez Chrome ou Edge sur un ordinateur, ou ouvrez un fichier enregistré.",
      dropHint: "Vous pouvez aussi déposer un fichier .packets (de pull_raw_data_v2.py) n'importe où sur la page.",
      dropHere: "Déposez le fichier pour le lire",
      downloadAll: "Tout télécharger (.zip)",
      downloadRaw: "Enregistrer les données brutes (.packets)",
      noGps: "Pas de trace GPS pour cette sortie (GPS éteint, ou non récupéré).",
      paceChart: "Vitesse pendant la sortie",
      faqTitle: "Questions",
      faq1q: "La montre n'apparaît pas dans la liste",
      faq1a: "Vérifiez que le dock est branché et que la montre est bien posée dessus, puis essayez un autre port USB. Fermez Nike+ Connect s'il est ouvert : il occupe la montre. Sous Linux, le navigateur a besoin d'une autorisation d'accès (une règle udev pour le vendor 11ac, product 5455).",
      faq2q: "Quels navigateurs fonctionnent ?",
      faq2a: "Chrome, Edge, Opera et les autres navigateurs basés sur Chromium, sur ordinateur (Windows, macOS, Linux). Firefox et Safari ne permettent pas à une page web de communiquer avec un appareil USB.",
      faq3q: "La date d'une sortie semble fausse",
      faq3a: "L'horloge de la montre peut dériver ou être fausse. Pour les sorties avec GPS, la date vient du GPS et elle est fiable ; sans GPS, seule l'horloge de la montre est disponible.",
      faq4q: "Il manque le cardio et les pas",
      faq4a: "Ces formats ne sont pas encore décodés : aucune ceinture cardio ni capteur de foulée n'était appairé sur la montre qui a servi à créer cet outil. Si vous avez des sorties avec, contactez-nous sur GitHub.",
      faq5q: "Est-ce sans risque pour la montre ?",
      faq5a: "Oui : la page n'envoie que la commande de lecture des sorties. Rien n'est effacé ni écrit, et vous pouvez lire la montre autant de fois que vous voulez.",
      footer1: "Projet open source, sans lien avec Nike ou TomTom.",
      footer2: "Réalisé avec",
      sConnecting: "Connexion à la montre…",
      sChecking: "Vérification de la mémoire de la montre…",
      sReading: (n, pass) => `Lecture de la montre (${pass}/2)… ${n} paquets`,
      sDecoding: "Décodage…",
      sFile: (name) => `Lecture de ${name}…`,
      runsFound: (n) => (n === 0 ? "Aucune sortie trouvée" : n === 1 ? "1 sortie trouvée" : `${n} sorties trouvées`),
      verifyOk: "Lue deux fois, copies identiques : les données sont complètes.",
      verifyDiff: "Les deux lectures diffèrent : le résultat est peut-être incomplet. Relisez la montre.",
      verifyFile: (name) => `Décodé depuis ${name}.`,
      empty: "La mémoire de la montre est vide : il n'y a aucune sortie à récupérer.",
      noRuns: "Les données ont été lues, mais aucune sortie n'a pu en être décodée.",
      eUnsupported: "Ce navigateur ne peut pas accéder aux appareils USB. Ouvrez cette page dans Chrome ou Edge, sur un ordinateur.",
      eCancelled: "Aucune montre choisie. Cliquez à nouveau sur « Connecter la montre » et choisissez-la dans la liste.",
      eOpen: "La montre a été trouvée mais n'a pas pu être ouverte. Fermez Nike+ Connect (ou tout autre programme qui utilise la montre), débranchez le dock, rebranchez-le et réessayez.",
      eOpenLinux: "Sous Linux, le navigateur a aussi besoin d'une autorisation : ajoutez une règle udev pour le vendor 11ac, product 5455.",
      eTimeout: "La montre ne répond pas. Vérifiez qu'elle est bien posée sur le dock, débranchez et rebranchez le dock, puis réessayez.",
      eFile: "Ce fichier n'a pas pu être lu. Il faut un fichier .packets (de cette page ou de pull_raw_data_v2.py) ou un .bin de mémoire brute.",
      eIncomplete: "La montre n'a envoyé qu'une partie de sa mémoire, même après plusieurs demandes. Débranchez le dock, rebranchez-le et réessayez.",
      eGeneric: "Une erreur s'est produite :",
      eHelp: "Si ça continue, signalez-le (lien ci-dessous).",
      dist: "Distance", dur: "Durée", pace: "Allure moy.", kcal: "Calories",
      noGpsBadge: "sans GPS", incomplete: "fin non enregistrée", watchClock: "date de l'horloge de la montre",
      gpx: "GPX", csv: "CSV vitesse",
      legend: (max) => `max ${max}`,
      noSpeed: "pas de données de vitesse",
      eraseTitle: "Vider la montre (expérimental)",
      eraseIntro: "Une fois sa mémoire pleine, la montre peut cesser d'enregistrer. Ceci efface toutes les sorties enregistrées sur la montre, comme le faisait Nike+ Connect après chaque synchronisation. C'est irréversible.",
      eraseExperimental: "Expérimental : la commande d'effacement n'a pas encore été confirmée sur une vraie montre. Si la montre la refuse, rien n'est perdu.",
      eraseStep1: "Téléchargez la sauvegarde (GPX, CSV et données brutes de chaque sortie) :",
      eraseBackup: "Télécharger la sauvegarde (.zip)",
      eraseBackupDone: "Sauvegarde téléchargée ✓",
      eraseWord: "EFFACER",
      eraseConfirm: (w) => `Tapez ${w} pour confirmer :`,
      eraseGo: "Vider la montre",
      eraseChecking: "Vérification que la montre contient toujours exactement les données sauvegardées…",
      eraseChanged: "La mémoire de la montre a changé depuis la sauvegarde (nouvelle sortie ?). Rien n'a été effacé : relisez la montre, puis recommencez.",
      eraseRunning: "Effacement… (jusqu'à 30 secondes — ne débranchez pas la montre)",
      eraseVerifying: "Vérification : nouvelle lecture de la montre…",
      eraseDone: "Terminé : la montre est vide. Vos sorties restent affichées sur cette page et dans la sauvegarde.",
      eraseFailed: "La montre contient toujours ses sorties : elle n'a pas effacé sa mémoire. Rien n'est perdu. Signalez-le (lien ci-dessous) avec le journal technique.",
      reportLink: "Signaler le problème : ouvrir une issue sur le dépôt GitHub",
      reportHint: "Joignez-y le journal technique (« Afficher le journal technique », puis Copier ou Télécharger).",
      logsIssue: "Ouvrir une issue sur GitHub",
      footerIssues: "Signaler un problème",
      logsShow: "Afficher le journal technique", logsHide: "Masquer le journal technique",
      logsHelp: "Tout ce que la page a envoyé à la montre et reçu d'elle. En cas de problème, joignez-le à une issue sur le dépôt GitHub. Il ne contient aucune position GPS.",
      logsCopy: "Copier", logsDownload: "Télécharger (.txt)", logsCopied: "Copié.",
      emptyHint: "Si vous savez que la montre contient des sorties, signalez-le : ouvrez une issue sur le dépôt GitHub (lien en bas de page) avec le journal technique ci-dessous.",
      seeLogs: "Le journal technique ci-dessous (« Afficher le journal technique ») explique ce qui s'est passé.",
    },
  };

  let lang = (() => {
    try { const s = localStorage.getItem("lang"); if (s === "fr" || s === "en") return s; } catch (_) {}
    return (navigator.language || "en").toLowerCase().startsWith("fr") ? "fr" : "en";
  })();
  const t = (k, ...a) => { const v = T[lang][k]; return typeof v === "function" ? v(...a) : v; };

  function applyLang() {
    document.documentElement.lang = lang;
    document.title = t("title");
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $("logs-btn").textContent = t($("logs").hidden ? "logsShow" : "logsHide");
    $("erase-confirm-label").textContent = t("eraseConfirm", t("eraseWord"));
    if (state.backupDone) $("erase-backup-ok").textContent = t("eraseBackupDone");
    document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    if (state.runs) renderRuns();
  }

  // ── Technical log ──────────────────────────────────────────────────────────

  const logLines = [];
  const t0 = performance.now();
  function log(msg) {
    const line = `[${((performance.now() - t0) / 1000).toFixed(3).padStart(8)} s] ${msg}`;
    logLines.push(line);
    if (logLines.length > 5000) logLines.splice(0, logLines.length - 5000);
    const pre = $("logs-text");
    if (pre && !$("logs").hidden) { pre.textContent = logLines.join("\n"); pre.scrollTop = pre.scrollHeight; }
  }
  W.setLogger(log);
  log(`page loaded — ${navigator.userAgent}`);
  log(`WebHID available: ${W.supported()}`);

  function toggleLogs(show) {
    const panel = $("logs");
    panel.hidden = show === undefined ? !panel.hidden : !show;
    $("logs-btn").setAttribute("aria-expanded", String(!panel.hidden));
    $("logs-btn").textContent = t(panel.hidden ? "logsShow" : "logsHide");
    if (!panel.hidden) { $("logs-text").textContent = logLines.join("\n"); $("logs-text").scrollTop = $("logs-text").scrollHeight; }
  }

  /** What the decoder found, for the log. */
  function logStream(stream) {
    const blocks = D.findBlocks(stream);
    const byClass = {};
    for (const b of blocks) {
      const k = `class ${b.cls}`;
      byClass[k] = byClass[k] || {};
      byClass[k][b.payload.length] = (byClass[k][b.payload.length] || 0) + 1;
    }
    const covered = blocks.reduce((n, b) => n + b.payload.length + 4, 0);
    log(`decoded stream: ${stream.length} bytes, ${blocks.length} CRC blocks (${stream.length ? Math.round(100 * covered / stream.length) : 0}% covered)`);
    for (const [k, sizes] of Object.entries(byClass)) {
      log(`  ${k}: ` + Object.entries(sizes).map(([len, n]) => `${n}×${len}B`).join(", "));
    }
  }

  // ── State ──────────────────────────────────────────────────────────────────

  const state = { runs: null, selected: 0, packets: null, verify: null, source: null, lastError: null, backupDone: false, erased: false };

  // ── Status / errors ────────────────────────────────────────────────────────

  function setStatus(text, fraction) {
    $("status").hidden = !text;
    $("status-text").textContent = text || "";
    const bar = $("status").querySelector(".bar");
    bar.classList.toggle("indeterminate", fraction == null);
    $("bar-fill").style.width = fraction == null ? "" : `${Math.round(fraction * 100)}%`;
  }

  /** "Report the problem" paragraph with a real link to the issues page. */
  function reportParagraph() {
    const p = document.createElement("p");
    p.className = "report";
    const a = document.createElement("a");
    a.href = ISSUES_URL; a.target = "_blank"; a.rel = "noopener";
    a.textContent = t("reportLink");
    p.append(a, " — " + t("reportHint"));
    return p;
  }

  function showError(messages) {
    log("ERROR shown: " + messages.filter(Boolean).join(" / "));
    messages = messages.concat([t("seeLogs")]);
    const box = $("error");
    box.replaceChildren(...messages.filter(Boolean).map((m) => { const p = document.createElement("p"); p.textContent = m; return p; }), reportParagraph());
    box.hidden = false;
    setStatus(null);
  }
  const clearError = () => { $("error").hidden = true; };

  function explain(err) {
    const code = err && err.code;
    if (code === "unsupported") return [t("eUnsupported")];
    if (code === "cancelled") return [t("eCancelled")];
    if (code === "timeout") return [t("eTimeout")];
    if (code === "incomplete") return [t("eIncomplete")];
    if (code === "open") return [t("eOpen"), /Linux/.test(navigator.userAgent) ? t("eOpenLinux") : null];
    return [t("eGeneric") + " " + (err && (err.message || err)), t("eHelp")];
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  let busy = false;

  async function readWatch() {
    if (busy) return;
    busy = true; clearError(); $("connect").disabled = true;
    let watch = null;
    try {
      setStatus(t("sConnecting"));
      watch = await W.connect();
      // The expected size is unknown before the first read: indeterminate bar.
      let expected = null;
      const reads = [];
      for (const pass of [1, 2]) {
        log(`read ${pass}/2 started`);
        const packets = await watch.readMemory((n, total) => setStatus(t("sReading", n, pass), total ? Math.min(1, n / total) : expected ? Math.min(1, n / expected) : null));
        reads.push(packets);
        expected = packets.length;
      }
      setStatus(t("sDecoding"));
      const identical = W.samePackets(reads[0], reads[1]);
      log(`reads identical: ${identical} (${reads[0].length} vs ${reads[1].length} packets)`);
      state.packets = reads[0];
      decodeAndShow(D.payloadStream(reads[0]), identical ? "ok" : "diff");
    } catch (err) {
      console.error(err);
      log(`exception: ${err && err.name}: ${err && (err.code || err.message)}${err && err.cause ? " / cause: " + err.cause : ""}`);
      showError(explain(err));
    } finally {
      if (watch) { await watch.close(); log("device closed"); }
      busy = false; $("connect").disabled = false;
    }
  }

  async function readFile(file) {
    if (!file || busy) return;
    clearError();
    try {
      setStatus(t("sFile", file.name));
      const buf = new Uint8Array(await file.arrayBuffer());
      log(`file opened: ${file.name}, ${buf.length} bytes`);
      const stream = file.name.toLowerCase().endsWith(".packets") ? D.payloadStream(D.parsePacketsFile(buf)) : buf;
      if (!stream.length) throw new Error("empty");
      state.packets = null;
      decodeAndShow(stream, "file:" + file.name);
    } catch (err) {
      console.error(err);
      log(`file error: ${err && err.message}`);
      showError([t("eFile")]);
    }
  }

  function decodeAndShow(stream, verify) {
    logStream(stream);
    const runs = D.decodeRuns(stream);
    log(`runs decoded: ${runs.length}` + runs.map((r) => ` | ${new Date(r.start * 1000).toISOString()} ${r.track.length} GPS pts, ${r.samples.length} speed samples, calories ${r.calories}`).join(""));
    // An empty (erased) watch only returns a device-info block (class 1).
    const hasWorkoutData = D.findBlocks(stream).some((b) => b.cls === 2 || b.cls === 4);
    setStatus(null);
    showResults(runs, verify, runs.length ? null : hasWorkoutData ? "noRuns" : "empty");
  }

  // ── Results ────────────────────────────────────────────────────────────────

  function showResults(runs, verify, emptyReason) {
    state.runs = runs; state.verify = verify; state.selected = runs.length - 1; state.emptyReason = emptyReason;
    resetErase();
    $("results").hidden = false;
    renderRuns();
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const fmtNum = (x, d) => new Intl.NumberFormat(lang, { minimumFractionDigits: d, maximumFractionDigits: d }).format(x);
  function fmtDuration(s) {
    if (s == null) return "—";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min ${String(sec).padStart(2, "0")} s`;
  }
  function runPace(r) {
    if (r.meanSpeed) return D.paceString(r.meanSpeed);
    if (r.distance && r.duration) return D.paceString(r.distance / r.duration);
    return "—";
  }

  function renderRuns() {
    const runs = state.runs || [];
    $("results-title").textContent = state.emptyReason === "empty" ? t("empty") : t("runsFound", runs.length);
    const note = $("verify-note");
    note.className = "note";
    if (state.emptyReason === "noRuns") note.textContent = t("noRuns") + " " + t("emptyHint");
    else if (state.emptyReason === "empty" && state.verify && !state.verify.startsWith("file:")) note.textContent = t("emptyHint");
    else if (state.verify === "ok") { note.textContent = t("verifyOk"); note.classList.add("ok"); }
    else if (state.verify === "diff") note.textContent = t("verifyDiff");
    else if (state.verify && state.verify.startsWith("file:")) note.textContent = t("verifyFile", state.verify.slice(5));
    else note.textContent = "";
    $("download-all").hidden = !runs.length;
    $("download-raw").hidden = !state.packets;
    document.querySelector(".layout").hidden = !runs.length;
    // Erasing is only offered after a complete, verified read of a watch that holds runs.
    $("erase").hidden = !(state.verify === "ok" && state.packets && runs.length && !state.erased);

    const list = $("runs");
    list.replaceChildren();
    const dateFmt = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const timeFmt = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" });
    runs.forEach((r, i) => {
      const li = document.createElement("li");
      li.className = "run"; li.tabIndex = 0; li.setAttribute("role", "button");
      li.setAttribute("aria-selected", String(i === state.selected));
      const d = new Date(r.start * 1000);
      const date = dateFmt.format(d);
      li.innerHTML = `
        <div class="run-date"></div>
        <div class="run-time"></div>
        <div class="stats">
          <div class="stat"><span>${t("dist")}</span><b>${r.distance != null ? fmtNum(r.distance / 1000, 2) + " km" : "—"}</b></div>
          <div class="stat"><span>${t("dur")}</span><b>${fmtDuration(r.duration)}</b></div>
          <div class="stat"><span>${t("pace")}</span><b>${runPace(r)}${runPace(r) !== "—" ? " /km" : ""}</b></div>
          <div class="stat"><span>${t("kcal")}</span><b>${r.calories != null ? r.calories : "—"}</b></div>
        </div>
        <div class="badges"></div>
        <div class="run-actions"></div>`;
      li.querySelector(".run-date").textContent = date.charAt(0).toUpperCase() + date.slice(1);
      li.querySelector(".run-time").textContent = timeFmt.format(d);
      const badges = li.querySelector(".badges");
      const addBadge = (txt) => { const b = document.createElement("span"); b.className = "badge"; b.textContent = txt; badges.append(b); };
      if (!r.track.length) addBadge(t("noGpsBadge"));
      if (!r.startFromGps) addBadge(t("watchClock"));
      if (r.complete === false) addBadge(t("incomplete"));
      if (!badges.children.length) badges.remove();
      const actions = li.querySelector(".run-actions");
      if (r.track.length) actions.append(fileButton(t("gpx"), () => download(D.fileStem(r) + ".gpx", D.toGpx(r), "application/gpx+xml")));
      if (r.samples.length) actions.append(fileButton(t("csv"), () => download(D.fileStem(r) + ".csv", D.toCsv(r), "text/csv")));
      const select = () => { state.selected = i; renderRuns(); };
      li.addEventListener("click", (e) => { if (!e.target.closest("button")) select(); });
      li.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === li) { e.preventDefault(); select(); } });
      list.append(li);
    });
    if (runs.length) showRun(runs[state.selected]);
  }

  function fileButton(label, action) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn small"; b.textContent = "⬇ " + label;
    b.addEventListener("click", action);
    return b;
  }

  // ── Map and chart ──────────────────────────────────────────────────────────

  let map = null, layer = null;

  function showRun(r) {
    const hasTrack = r.track.length > 1;
    $("map").hidden = !hasTrack;
    $("map-empty").hidden = hasTrack;
    if (hasTrack && window.L) {
      if (!map) {
        map = L.map("map", { scrollWheelZoom: false });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
      }
      if (layer) layer.remove();
      const latlngs = r.track.map((p) => [p.lat, p.lon]);
      const color = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#ff5a1f";
      layer = L.featureGroup([
        L.polyline(latlngs, { color, weight: 4, opacity: 0.9 }),
        L.circleMarker(latlngs[0], { radius: 7, color: "#fff", weight: 2, fillColor: "#1a8a4a", fillOpacity: 1 }),
        L.circleMarker(latlngs[latlngs.length - 1], { radius: 7, color: "#fff", weight: 2, fillColor: "#c62828", fillOpacity: 1 }),
      ]).addTo(map);
      setTimeout(() => { map.invalidateSize(); map.fitBounds(layer.getBounds(), { padding: [24, 24] }); }, 0);
    }
    drawChart(r);
  }

  function drawChart(r) {
    const canvas = $("chart");
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = 140;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const vals = r.samples.map((s) => (s.speed && s.speed < 0xfe ? s.speed / 10 * 3.6 : null));
    const ok = vals.filter((v) => v != null);
    if (!ok.length) {
      $("chart-legend").textContent = t("noSpeed");
      return;
    }
    // Light smoothing: the watch has isolated spikes.
    const smooth = vals.map((_, i) => {
      const win = vals.slice(Math.max(0, i - 4), i + 5).filter((v) => v != null);
      return win.length ? win.sort((a, b) => a - b)[Math.floor(win.length / 2)] : null;
    });
    const max = Math.max(...smooth.filter((v) => v != null)) * 1.1 || 1;
    $("chart-legend").textContent = t("legend", fmtNum(max / 1.1, 1) + " km/h");
    ctx.strokeStyle = css.getPropertyValue("--line"); ctx.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75]) { ctx.beginPath(); ctx.moveTo(0, h * f); ctx.lineTo(w, h * f); ctx.stroke(); }
    ctx.strokeStyle = css.getPropertyValue("--accent"); ctx.lineWidth = 2; ctx.lineJoin = "round";
    ctx.beginPath();
    let pen = false;
    smooth.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      const x = (i / Math.max(1, smooth.length - 1)) * w, y = h - (v / max) * (h - 8) - 4;
      if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; }
    });
    ctx.stroke();
  }

  // ── Downloads ──────────────────────────────────────────────────────────────

  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  async function downloadAll({ withRaw = false, name = "nike-sportwatch-runs.zip" } = {}) {
    const runs = state.runs || [];
    if (window.JSZip) {
      const zip = new JSZip();
      for (const r of runs) {
        if (r.track.length) zip.file("gpx/" + D.fileStem(r) + ".gpx", D.toGpx(r));
        if (r.samples.length) zip.file("csv/" + D.fileStem(r) + ".csv", D.toCsv(r));
      }
      if (withRaw && state.packets) zip.file("raw/watch.packets", D.serializePackets(state.packets));
      download(name, await zip.generateAsync({ type: "blob" }));
    } else {
      for (const r of runs) if (r.track.length) download(D.fileStem(r) + ".gpx", D.toGpx(r), "application/gpx+xml");
      if (withRaw && state.packets) download("watch.packets", new Blob([D.serializePackets(state.packets)]));
    }
  }

  // ── Erasing the watch ──────────────────────────────────────────────────────

  function resetErase() {
    state.backupDone = false;
    $("erase-backup-ok").textContent = "";
    $("erase-confirm").value = "";
    $("erase-confirm").disabled = true;
    $("erase-go").disabled = true;
    $("erase-status").hidden = true;
  }

  function eraseStatus(text, kind) {
    const box = $("erase-status");
    box.hidden = !text;
    box.className = "erase-status" + (kind ? " " + kind : "");
    box.replaceChildren(...[].concat(text || []).map((m) => { const p = document.createElement("p"); p.textContent = m; return p; }));
    if (kind === "bad") box.append(reportParagraph());
  }

  const confirmOk = () => $("erase-confirm").value.trim().toUpperCase() === t("eraseWord");

  async function eraseWatch() {
    if (busy || !state.backupDone || !confirmOk()) return;
    busy = true;
    $("erase-go").disabled = true; $("erase-confirm").disabled = true; $("connect").disabled = true;
    let watch = null;
    log("ERASE requested by the user");
    try {
      watch = await W.connect();
      eraseStatus(t("eraseChecking"));
      const now = await watch.readMemory(null, { fresh: true });
      if (!W.samePackets(now, state.packets)) {
        log(`memory differs from the backup (${now.length} vs ${state.packets.length} packets): erase cancelled`);
        eraseStatus(t("eraseChanged"), "bad");
        return;
      }
      eraseStatus(t("eraseRunning"));
      await watch.erase();
      await new Promise((r) => setTimeout(r, 2000));
      eraseStatus(t("eraseVerifying"));
      const after = D.payloadStream(await watch.readMemory(null, { fresh: true }));
      logStream(after);
      const stillThere = D.findBlocks(after).some((b) => b.cls === 2 || b.cls === 4);
      if (stillThere) {
        log("watch still holds workout data after the erase command");
        eraseStatus([t("eraseFailed")], "bad");
      } else {
        log("watch is empty after the erase command");
        state.erased = true;
        eraseStatus(t("eraseDone"), "ok");
        $("download-raw").hidden = false;
      }
    } catch (err) {
      console.error(err);
      log(`erase exception: ${err && err.name}: ${err && (err.code || err.message)}`);
      eraseStatus(explain(err).concat([t("seeLogs")]), "bad");
    } finally {
      if (watch) { await watch.close(); log("device closed"); }
      busy = false; $("connect").disabled = false;
      if (!state.erased) { $("erase-confirm").disabled = !state.backupDone; $("erase-go").disabled = !(state.backupDone && confirmOk()); }
    }
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────

  document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => {
    lang = b.dataset.lang;
    try { localStorage.setItem("lang", lang); } catch (_) {}
    applyLang();
  }));
  $("connect").addEventListener("click", readWatch);
  $("logs-btn").addEventListener("click", () => toggleLogs());
  $("logs-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(logLines.join("\n")); $("logs-copied").textContent = t("logsCopied"); }
    catch (_) { const r = document.createRange(); r.selectNodeContents($("logs-text")); getSelection().removeAllRanges(); getSelection().addRange(r); }
    setTimeout(() => { $("logs-copied").textContent = ""; }, 2500);
  });
  $("logs-download").addEventListener("click", () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    download(`nike-sportwatch-log_${stamp}.txt`, logLines.join("\n") + "\n", "text/plain");
  });
  $("file").addEventListener("change", (e) => { readFile(e.target.files[0]); e.target.value = ""; });
  $("download-all").addEventListener("click", () => downloadAll());
  $("erase-backup").addEventListener("click", async () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    await downloadAll({ withRaw: true, name: `nike-sportwatch-backup_${stamp}.zip` });
    state.backupDone = true;
    log("backup zip downloaded (GPX, CSV, raw packets)");
    $("erase-backup-ok").textContent = t("eraseBackupDone");
    $("erase-confirm").disabled = false;
    $("erase-confirm").focus();
  });
  $("erase-confirm").addEventListener("input", () => { $("erase-go").disabled = !(state.backupDone && confirmOk() && !busy); });
  $("erase-go").addEventListener("click", eraseWatch);
  $("download-raw").addEventListener("click", () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    download(`nike_watch_${stamp}.packets`, new Blob([D.serializePackets(state.packets)]));
  });

  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { dragDepth++; $("dropzone").hidden = false; } });
  window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $("dropzone").hidden = true; });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault(); dragDepth = 0; $("dropzone").hidden = true;
    readFile(e.dataTransfer.files[0]);
  });
  window.addEventListener("resize", () => { if (state.runs && state.runs.length) drawChart(state.runs[state.selected]); });

  if (!W.supported()) { $("connect").disabled = true; $("unsupported").hidden = false; }
  applyLang();
})();
