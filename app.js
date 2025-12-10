const SUPABASE_URL = "https://oafywoleknpytawuvcit.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hZnl3b2xla25weXRhd3V2Y2l0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUzMDY3MzEsImV4cCI6MjA4MDg4MjczMX0.j7UOKGI6SVpUe_o0NyEgXwDL_4_MnIkV7yjTPCO5848";
const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

const state = {
  session: null,
  profile: null,
  documents: [],
  latestByDoc: {},
  selectedDocumentId: null,
  entries: [],
  filters: { chip: "All", search: "" },
  channels: { docs: null, entries: null },
  autoScroll: true,
  editingEntryId: null,
  titleEditing: false,
  currentTab: "Notes"
};

function initAuth() {
  const emailEl = document.getElementById("auth-email");
  const passEl = document.getElementById("auth-password");
  const alertEl = document.getElementById("auth-alert");
  const btnLoginInit = document.getElementById("btn-login");
  const btnSignupInit = document.getElementById("btn-signup");
  if (btnLoginInit) btnLoginInit.disabled = false;
  if (btnSignupInit) btnSignupInit.disabled = false;
  if (!storageWorks()) {
    alertEl.textContent = "Enable cookies/local storage for authentication";
    alertEl.classList.remove("hidden");
  }
  function setAlert(msg, ok=false){
    alertEl.textContent = msg;
    alertEl.classList.remove("hidden");
    alertEl.classList.toggle("success", !!ok);
    alertEl.classList.toggle("error", !ok);
  }
  function clearAlert(){
    alertEl.classList.add("hidden");
    alertEl.textContent = "";
    alertEl.classList.remove("success");
  }
  document.getElementById("btn-login").addEventListener("click", async () => {
    const btnLogin = document.getElementById("btn-login");
    const btnSignup = document.getElementById("btn-signup");
    try {
      btnLogin.disabled = true; btnSignup.disabled = true; clearAlert();
      const email = emailEl.value.trim(); const password = passEl.value;
      if (!email || !password){ setAlert("Enter email and password"); return; }
      setAlert("Signing in...");
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) { setAlert(error.message || "Login failed"); return; }
      if (data && data.session) {
        setAlert("Logged in", true);
        await ensureProfile();
        showApp();
        await loadDocuments();
        initRealtime();
      } else {
        const sess = await awaitSession(4000, 200);
        if (sess) {
          setAlert("Logged in", true);
          await ensureProfile();
          showApp();
          await loadDocuments();
          initRealtime();
        } else {
          setAlert("Login did not start a session");
        }
      }
    } catch (err) {
      setAlert((err && err.message) ? err.message : "Unexpected error during login");
    } finally {
      btnLogin.disabled=false; btnSignup.disabled=false;
    }
  });
  document.getElementById("btn-signup").addEventListener("click", async () => {
    const btnLogin = document.getElementById("btn-login");
    const btnSignup = document.getElementById("btn-signup");
    try {
      btnLogin.disabled = true; btnSignup.disabled = true; clearAlert();
      const email = emailEl.value.trim(); const password = passEl.value;
      if (!email || !password){ setAlert("Enter email and password"); return; }
      const proto = window.location.protocol;
      const redirectTo = proto.startsWith("http") ? window.location.origin : undefined;
      const { data, error } = await client.auth.signUp({ email, password, options: redirectTo ? { emailRedirectTo: redirectTo } : {} });
      if (error) { setAlert(error.message || "Sign up failed"); return; }
      if (data.session) { setAlert("Signed up and logged in", true); }
      else {
        if (proto === "file:") setAlert("Email confirmation required. Serve over http://localhost and retry.");
        else {
          setAlert("Check email to confirm before login", true);
          const retry = await client.auth.signInWithPassword({ email, password });
          let hasSession = !retry.error && retry.data && retry.data.session;
          if (!hasSession) {
            const sess = await awaitSession(4000, 200);
            hasSession = !!sess;
          }
          if (hasSession) {
            setAlert("Logged in", true);
            await ensureProfile();
            showApp();
            await loadDocuments();
            initRealtime();
          }
        }
      }
    } catch (err) {
      setAlert((err && err.message) ? err.message : "Unexpected error during signup");
    } finally {
      btnLogin.disabled=false; btnSignup.disabled=false;
    }
  });
  client.auth.onAuthStateChange(async (event, session) => {
    state.session = session;
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
      clearAlert();
      await ensureProfile();
      showApp();
      await loadDocuments();
      initRealtime();
      return;
    }
    if (event === "SIGNED_OUT") {
      showAuth();
      return;
    }
    if (session) {
      showApp();
    } else {
      showAuth();
    }
  });
  client.auth.getSession().then(({ data }) => {
    state.session = data.session;
    if (state.session) {
      ensureProfile().then(() => {
        showApp();
        loadDocuments();
        initRealtime();
      });
    } else {
      showAuth();
    }
  });
}

async function ensureProfile() {
  try {
    const { data: userData, error: userErr } = await client.auth.getUser();
    if (userErr || !userData || !userData.user) return;
    const uid = userData.user.id;
    const email = userData.user.email;
    const { data: existing, error: selErr } = await client.from("users").select("*").eq("id", uid).maybeSingle();
    if (selErr) return;
    if (!existing) {
      const name = email ? email.split("@")[0] : "User";
      const color = randomColor();
      await client.from("users").insert({ id: uid, display_name: name, color });
    }
    const { data: profile } = await client.from("users").select("*").eq("id", uid).maybeSingle();
    state.profile = profile;
  } catch (_) {}
}

function initRealtime() {
  if (state.channels.docs) state.channels.docs.unsubscribe();
  state.channels.docs = client.channel("docs").on(
    "postgres_changes",
    { event: "*", schema: "public", table: "documents" },
    async () => { await loadDocuments(); }
  ).subscribe();
}

function showAuth() {
  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("app-screen").classList.add("hidden");
}

function showApp() {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.remove("hidden");
  navigate("Notes");
}

async function loadDocuments() {
  const { data: docs } = await client.from("documents").select("id,title,created_by,created_at,updated_at").order("updated_at", { ascending: false });
  state.documents = docs || [];
  const ids = state.documents.map(d => d.id);
  state.latestByDoc = {};
  if (ids.length) {
    const { data: latest } = await client.from("entries").select("id,document_id,author_name,content,created_at").in("document_id", ids).order("created_at", { ascending: false });
    if (latest) {
      for (const e of latest) {
        if (!state.latestByDoc[e.document_id]) state.latestByDoc[e.document_id] = e;
      }
    }
  }
  renderDocumentsList();
}

async function createDocument() {
  const title = prompt("New document title");
  if (!title) return;
  await client.from("documents").insert({ title });
}

async function createDocumentInline(title) {
  const { data, error } = await client.from("documents").insert({ title }).select("*").single();
  if (error) return { error };
  await loadDocuments();
  if (data && data.id) await openDocument(data.id);
  return { data };
}

function renderDocumentsList() {
  const list = document.getElementById("documents-list");
  list.innerHTML = "";
  const now = new Date();
  const filtered = state.documents.filter(d => {
    const latest = state.latestByDoc[d.id];
    const text = ((d.title || "") + " " + (latest ? (latest.author_name + ": " + (latest.content || "")) : "")).toLowerCase();
    const s = state.filters.search.toLowerCase();
    if (s && !text.includes(s)) return false;
    if (state.filters.chip === "Mine" && d.created_by !== state.session.user.id) return false;
    if (state.filters.chip === "Shared" && d.created_by === state.session.user.id) return false;
    if (state.filters.chip === "Today") {
      const a = latest ? new Date(latest.created_at) : new Date(d.updated_at || d.created_at);
      const isToday = sameDay(a, now);
      if (!isToday) return false;
    }
    if (state.filters.chip === "This Week") {
      const a = latest ? new Date(latest.created_at) : new Date(d.updated_at || d.created_at);
      if (!sameWeek(a, now)) return false;
    }
    return true;
  });
  for (const d of filtered) {
    const li = document.createElement("li");
    li.className = "doc-item";
    const avatar = document.createElement("div");
    avatar.className = "doc-avatar";
    avatar.textContent = (d.title || "?").slice(0,1).toUpperCase();
    const center = document.createElement("div");
    center.className = "doc-center";
    const title = document.createElement("div");
    title.className = "doc-title";
    title.textContent = d.title || "Untitled";
    const snippet = document.createElement("div");
    snippet.className = "doc-snippet";
    const latest = state.latestByDoc[d.id];
    snippet.textContent = latest ? (latest.author_name + ": " + (latest.content || "")) : "No entries yet";
    center.appendChild(title);
    center.appendChild(snippet);
    const right = document.createElement("div");
    right.className = "doc-right";
    const t = latest ? new Date(latest.created_at) : new Date(d.updated_at || d.created_at);
    right.textContent = humanizeTime(t);
    li.appendChild(avatar);
    li.appendChild(center);
    li.appendChild(right);
    li.addEventListener("click", () => openDocument(d.id));
    list.appendChild(li);
  }
}

async function openDocument(id) {
  navigate("Notes");
  state.selectedDocumentId = id;
  document.getElementById("document-detail").classList.remove("hidden");
  document.getElementById("documents-list").parentElement.scrollTop = 0;
  const doc = state.documents.find(x => x.id === id);
  document.getElementById("document-title").textContent = doc ? (doc.title || "Untitled") : "Document";
  await loadEntries(id);
  if (state.channels.entries) state.channels.entries.unsubscribe();
  state.channels.entries = client.channel("entries-" + id).on(
    "postgres_changes",
    { event: "*", schema: "public", table: "entries", filter: "document_id=eq." + id },
    payload => handleEntryRealtime(payload)
  ).subscribe();
}

function handleEntryRealtime(payload) {
  if (!state.selectedDocumentId) return;
  const e = payload.new || payload.old;
  if (payload.eventType === "INSERT") {
    state.entries.push(payload.new);
  }
  if (payload.eventType === "UPDATE") {
    const i = state.entries.findIndex(x => x.id === payload.new.id);
    if (i !== -1) state.entries[i] = payload.new;
  }
  if (payload.eventType === "DELETE") {
    const i = state.entries.findIndex(x => x.id === e.id);
    if (i !== -1) state.entries.splice(i,1);
  }
  const list = document.getElementById("entries-list");
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  renderEntriesList();
  if (nearBottom) list.scrollTop = list.scrollHeight;
}

async function loadEntries(documentId) {
  const { data: entries } = await client.from("entries").select("id,document_id,author_id,author_name,author_color,content,created_at,updated_at,is_deleted").eq("document_id", documentId).order("created_at", { ascending: true });
  state.entries = entries || [];
  renderEntriesList();
  const list = document.getElementById("entries-list");
  list.scrollTop = list.scrollHeight;
}

async function createEntry(documentId, content) {
  if (!content || !content.trim()) return;
  const btn = document.getElementById("btn-add-entry");
  const err = document.getElementById("entry-error");
  btn.disabled = true; err.classList.add("hidden");
  const { error } = await client.from("entries").insert({ document_id: documentId, content });
  if (error) { err.textContent = error.message || "Failed to add entry"; err.classList.remove("hidden"); btn.disabled = false; return; }
  const ta = document.getElementById("entry-text");
  ta.value = "";
  document.getElementById("char-count").textContent = "0";
  btn.disabled = false;
}

async function editEntry(entryId, content) {
  await client.from("entries").update({ content, updated_at: new Date().toISOString() }).eq("id", entryId);
}

async function softDeleteEntry(entryId) {
  await client.from("entries").update({ is_deleted: true, content: "" }).eq("id", entryId);
}

function renderEntriesList() {
  const list = document.getElementById("entries-list");
  list.innerHTML = "";
  for (let i = 0; i < state.entries.length; i++) {
    const e = state.entries[i];
    const item = document.createElement("div");
    item.className = "entry" + (i % 2 === 0 ? "" : " alt");
    const top = document.createElement("div");
    top.className = "entry-top";
    const badge = document.createElement("div");
    badge.className = "author-badge";
    const dot = document.createElement("span");
    dot.style.width = "10px";
    dot.style.height = "10px";
    dot.style.borderRadius = "999px";
    dot.style.background = e.author_color || "#888";
    const name = document.createElement("span");
    name.textContent = e.author_name || "Author";
    badge.appendChild(dot);
    badge.appendChild(name);
    const time = document.createElement("div");
    time.className = "entry-time";
    time.textContent = humanizeTime(new Date(e.created_at));
    top.appendChild(badge);
    top.appendChild(time);
  item.appendChild(top);
  if (e.is_deleted) {
    const del = document.createElement("div");
    del.className = "entry-content deleted-placeholder";
    del.textContent = "Entry deleted by the author";
    item.appendChild(del);
  } else if (state.editingEntryId === e.id) {
    const editor = document.createElement("textarea");
    editor.className = "field";
    editor.value = e.content || "";
    item.appendChild(editor);
    const actions = document.createElement("div");
    actions.className = "entry-actions-row";
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn primary";
    saveBtn.textContent = "Save";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn";
    cancelBtn.textContent = "Cancel";
    saveBtn.addEventListener("click", async () => { await editEntry(e.id, editor.value); state.editingEntryId = null; renderEntriesList(); });
    cancelBtn.addEventListener("click", () => { state.editingEntryId = null; renderEntriesList(); });
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    item.appendChild(actions);
  } else {
    const content = document.createElement("div");
    content.className = "entry-content";
    content.textContent = e.content || "";
    item.appendChild(content);
  }
    if (!e.is_deleted && state.session && e.author_id === state.session.user.id) {
      const actions = document.createElement("div");
      actions.className = "entry-actions-row";
      const editBtn = document.createElement("button");
      editBtn.className = "small-icon-btn";
      editBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 000-1.42l-2.34-2.34a1.003 1.003 0 00-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/></svg>';
      editBtn.addEventListener("click", async () => { state.editingEntryId = e.id; renderEntriesList(); });
      const delBtn = document.createElement("button");
      delBtn.className = "small-icon-btn";
      delBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 7h12v2H6zm2 4h8v8H8zM9 4h6l1 2H8l1-2z"/></svg>';
      delBtn.addEventListener("click", async () => { await softDeleteEntry(e.id); });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      item.appendChild(actions);
    }
    list.appendChild(item);
  }
}

function bindUI() {
  document.getElementById("btn-new-doc").addEventListener("click", () => {
    const m = document.getElementById("new-doc-modal");
    document.getElementById("new-doc-title").value = "";
    document.getElementById("new-doc-error").classList.add("hidden");
    m.classList.remove("hidden");
  });
  document.getElementById("menu-new-doc").addEventListener("click", () => {
    document.getElementById("menu-panel").classList.add("hidden");
    const m = document.getElementById("new-doc-modal");
    document.getElementById("new-doc-title").value = "";
    document.getElementById("new-doc-error").classList.add("hidden");
    m.classList.remove("hidden");
  });
  document.getElementById("new-doc-cancel").addEventListener("click", () => {
    document.getElementById("new-doc-modal").classList.add("hidden");
  });
  document.getElementById("new-doc-create").addEventListener("click", async () => {
    const title = document.getElementById("new-doc-title").value.trim();
    if (!title) { const el = document.getElementById("new-doc-error"); el.textContent = "Enter a title"; el.classList.remove("hidden"); return; }
    const res = await createDocumentInline(title);
    if (res.error) { const el = document.getElementById("new-doc-error"); el.textContent = res.error.message || "Failed to create"; el.classList.remove("hidden"); return; }
    document.getElementById("new-doc-modal").classList.add("hidden");
  });
  document.getElementById("btn-camera").addEventListener("click", () => {
    document.getElementById("quick-note-text").value = "";
    document.getElementById("quick-note-error").classList.add("hidden");
    document.getElementById("quick-note-modal").classList.remove("hidden");
  });
  document.getElementById("quick-note-cancel").addEventListener("click", () => {
    document.getElementById("quick-note-modal").classList.add("hidden");
  });
  document.getElementById("quick-note-add").addEventListener("click", async () => {
    const content = document.getElementById("quick-note-text").value;
    if (!state.selectedDocumentId) { const el = document.getElementById("quick-note-error"); el.textContent = "Open a document first"; el.classList.remove("hidden"); return; }
    const { error } = await client.from("entries").insert({ document_id: state.selectedDocumentId, content });
    if (error) { const el = document.getElementById("quick-note-error"); el.textContent = error.message || "Failed"; el.classList.remove("hidden"); return; }
    document.getElementById("quick-note-modal").classList.add("hidden");
  });
  document.getElementById("btn-menu").addEventListener("click", () => {
    document.getElementById("menu-panel").classList.toggle("hidden");
  });
  document.getElementById("menu-signout").addEventListener("click", async () => {
    document.getElementById("menu-panel").classList.add("hidden");
    await client.auth.signOut();
  });
  document.getElementById("btn-back").addEventListener("click", () => {
    state.selectedDocumentId = null;
    document.getElementById("document-detail").classList.add("hidden");
    renderDocumentsList();
  });
  document.getElementById("btn-doc-info").addEventListener("click", () => {
    const panel = document.getElementById("doc-info-panel");
    panel.classList.toggle("hidden");
    const d = state.documents.find(x => x.id === state.selectedDocumentId);
    if (d) {
      const creator = state.session && d.created_by === state.session.user.id;
      let html = "<div>Document ID: " + d.id + "</div><div>Created by: " + d.created_by + "</div><div>Created at: " + new Date(d.created_at).toLocaleString() + "</div>";
      if (creator) {
        html += '<div style="margin-top:8px;display:flex;gap:8px"><button id="btn-rename-doc" class="btn">Rename</button><button id="btn-delete-doc" class="btn">Delete</button></div>';
      }
      panel.innerHTML = html;
      if (creator) {
        const rn = document.getElementById("btn-rename-doc");
        const del = document.getElementById("btn-delete-doc");
        rn.addEventListener("click", () => { beginTitleEdit(d.title || ""); });
        del.addEventListener("click", async () => { await deleteDocument(d.id); panel.classList.add("hidden"); state.selectedDocumentId = null; });
      }
    }
  });
  document.getElementById("search-input").addEventListener("input", e => {
    state.filters.search = e.target.value;
    renderDocumentsList();
  });
  document.getElementById("chips-row").addEventListener("click", e => {
    if (e.target.classList.contains("chip")) {
      document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
      e.target.classList.add("active");
      state.filters.chip = e.target.dataset.chip;
      renderDocumentsList();
    }
  });
  const ta = document.getElementById("entry-text");
  ta.addEventListener("input", () => {
    document.getElementById("char-count").textContent = String(ta.value.length);
  });
  document.getElementById("btn-add-entry").addEventListener("click", () => {
    if (!state.selectedDocumentId) return;
    createEntry(state.selectedDocumentId, document.getElementById("entry-text").value);
  });
  document.getElementById("document-title").addEventListener("click", () => {
    const d = state.documents.find(x => x.id === state.selectedDocumentId);
    if (!d || !state.session || d.created_by !== state.session.user.id) return;
    beginTitleEdit(d.title || "");
  });
  document.getElementById("title-cancel").addEventListener("click", () => { endTitleEdit(); });
  document.getElementById("title-save").addEventListener("click", async () => {
    const val = document.getElementById("document-title-input").value.trim();
    if (!val) return;
    await renameDocument(state.selectedDocumentId, val);
    endTitleEdit();
  });

  document.getElementById("nav-notes").addEventListener("click", () => navigate("Notes"));
  document.getElementById("nav-activity").addEventListener("click", () => navigate("Activity"));
  document.getElementById("nav-groups").addEventListener("click", () => navigate("Groups"));
  document.getElementById("nav-settings").addEventListener("click", () => navigate("Settings"));
}

function randomColor() {
  const colors = ["#25D366","#27ae60","#2ecc71","#3498db","#9b59b6","#e67e22","#e74c3c","#16a085"]; 
  return colors[Math.floor(Math.random()*colors.length)];
}

function humanizeTime(d) {
  const now = new Date();
  if (sameDay(d, now)) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const diff = now - d;
  const y = new Date(now);
  y.setDate(now.getDate()-1);
  if (sameDay(d, y)) return "Yesterday";
  const weekNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  if (sameWeek(d, now)) return weekNames[d.getDay()];
  return d.toLocaleDateString();
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function sameWeek(a, b) {
  const oneDay = 24*60*60*1000;
  const start = new Date(b);
  start.setHours(0,0,0,0);
  const day = start.getDay();
  const diffToMonday = (day + 6) % 7;
  start.setTime(start.getTime() - diffToMonday*oneDay);
  const end = new Date(start);
  end.setTime(end.getTime() + 7*oneDay);
  return a >= start && a < end;
}

document.addEventListener("DOMContentLoaded", () => {
  bindUI();
  initAuth();
});

function storageWorks() {
  try { localStorage.setItem("__sn_test__", "1"); localStorage.removeItem("__sn_test__"); return true; } catch (_) { return false; }
}

async function awaitSession(timeoutMs=3000, intervalMs=200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await client.auth.getSession();
    if (data && data.session) return data.session;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}

async function renameDocument(id, title) {
  await client.from("documents").update({ title, updated_at: new Date().toISOString() }).eq("id", id);
  await loadDocuments();
  if (state.selectedDocumentId === id) document.getElementById("document-title").textContent = title;
}

async function deleteDocument(id) {
  await client.from("documents").delete().eq("id", id);
  await loadDocuments();
  document.getElementById("document-detail").classList.add("hidden");
}

function beginTitleEdit(current) {
  const input = document.getElementById("document-title-input");
  const actions = document.getElementById("document-title-actions");
  input.value = current || "";
  input.classList.remove("hidden");
  actions.classList.remove("hidden");
  state.titleEditing = true;
}

function endTitleEdit() {
  document.getElementById("document-title-input").classList.add("hidden");
  document.getElementById("document-title-actions").classList.add("hidden");
  state.titleEditing = false;
}

function navigate(tab) {
  state.currentTab = tab;
  const tabs = ["Notes","Activity","Groups","Settings"];
  for (const t of tabs) {
    document.getElementById("view-" + t.toLowerCase()).classList.toggle("hidden", t !== tab);
    const btn = document.getElementById("nav-" + t.toLowerCase());
    if (btn) btn.classList.toggle("active", t === tab);
  }
  document.getElementById("menu-panel").classList.add("hidden");
}
