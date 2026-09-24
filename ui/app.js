"use strict";

// ---------- Backend bridge (falls back to localStorage in a plain browser) ----------
const tauri = window.__TAURI__;
const backend = tauri
  ? {
      load: () => tauri.core.invoke("load_state"),
      save: (state) => tauri.core.invoke("save_state", { state }),
      pin: (pinned) => tauri.core.invoke("set_pinned", { pinned }),
      dock: (hidden) => tauri.core.invoke("set_dock_hidden", { hidden }),
      autostart: (enabled) => tauri.core.invoke("set_autostart", { enabled }),
    }
  : {
      load: async () => JSON.parse(localStorage.getItem("desk-todo") || "null"),
      save: async (state) => localStorage.setItem("desk-todo", JSON.stringify(state)),
      pin: async () => {},
      dock: async () => {},
      autostart: async () => {},
    };

// ---------- Constants ----------
const ICONS = {
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M4 10.5L12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z"/><path d="M9 13.5l2 2 4-4"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".6"/><circle cx="4.5" cy="12" r=".6"/><circle cx="4.5" cy="18" r=".6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  dock: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M7 21h10"/></svg>',
  power: '<svg viewBox="0 0 24 24"><path d="M12 3v8M6.4 6.6a8 8 0 1 0 11.2 0"/></svg>',
  move: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

const THEMES = {
  blue: ["#5a6bbd", "#7486d6"],
  purple: ["#7b4fb0", "#a07fd0"],
  pink: ["#c2185b", "#e0628f"],
  red: ["#c0392b", "#e2725f"],
  orange: ["#d35400", "#f0934f"],
  green: ["#2e7d4f", "#5cae7c"],
  teal: ["#0f7b6c", "#3fae9d"],
  gray: ["#4f5663", "#7d8594"],
};

const SMART = [
  { id: "myday", name: "我的一天", icon: "sun", color: "#555", theme: "green" },
  { id: "important", name: "重要", icon: "star", color: "#c2185b", theme: "pink" },
  { id: "planned", name: "计划内", icon: "calendar", color: "#0f7b6c", theme: "teal" },
  { id: "inbox", name: "任务", icon: "home", color: "#5a6bbd", theme: "blue" },
];

// ---------- State ----------
const defaultState = () => ({
  version: 1,
  pinned: true,
  dockHidden: false,
  autostart: true,
  sidebarCollapsed: false,
  selected: "inbox",
  themes: {},
  showCompleted: {},
  lists: [],
  tasks: [],
});

let state = defaultState();
let query = "";
let saveTimer = 0;

const $ = (sel) => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => ymd(new Date());
const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => backend.save(state).catch(console.error), 150);
}

function commit() {
  persist();
  render();
}

function el(tag, cls, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html) node.innerHTML = html;
  return node;
}

// ---------- Views ----------
function viewOf(id) {
  const smart = SMART.find((v) => v.id === id);
  if (smart) return { ...smart, smart: true };
  const list = state.lists.find((l) => l.id === id);
  if (list) return { id: list.id, name: list.name, icon: "list", color: "#5a6bbd", theme: "blue", smart: false };
  return null;
}

function tasksIn(id) {
  const t = today();
  switch (id) {
    case "myday":
      return state.tasks.filter((x) => x.myDay === t);
    case "important":
      return state.tasks.filter((x) => x.important);
    case "planned":
      return state.tasks.filter((x) => x.due);
    default:
      return state.tasks.filter((x) => x.listId === id);
  }
}

const openCount = (id) => tasksIn(id).filter((x) => !x.done).length;
const listName = (id) => (id === "inbox" ? "任务" : state.lists.find((l) => l.id === id)?.name ?? "任务");

// ---------- Render ----------
function render() {
  renderSidebar();
  renderMain();
}

function navItem(view, count) {
  const btn = el("button", "nav-item" + (!query && state.selected === view.id ? " active" : ""));
  btn.dataset.id = view.id;
  const icon = el("span", "", ICONS[view.icon]);
  icon.style.color = view.color;
  icon.style.display = "grid";
  const label = el("span", "label");
  label.textContent = view.name;
  btn.append(icon, label);
  if (count) {
    const c = el("span", "count");
    c.textContent = count;
    btn.append(c);
  }
  btn.addEventListener("click", () => select(view.id));
  // Drop a task onto a list to move it there.
  if (view.id === "inbox" || !view.smart || view.id === "important" || view.id === "myday") {
    btn.addEventListener("dragover", (e) => {
      if (!dragTaskId) return;
      e.preventDefault();
      btn.classList.add("drop-target");
    });
    btn.addEventListener("dragleave", () => btn.classList.remove("drop-target"));
    btn.addEventListener("drop", (e) => {
      e.preventDefault();
      btn.classList.remove("drop-target");
      const task = state.tasks.find((x) => x.id === dragTaskId);
      if (!task) return;
      if (view.id === "important") task.important = true;
      else if (view.id === "myday") task.myDay = today();
      else task.listId = view.id;
      commit();
    });
  }
  return btn;
}

function renderSidebar() {
  const smart = $("#smart-nav");
  smart.replaceChildren(...SMART.map((v) => navItem(v, openCount(v.id))));
  const lists = $("#list-nav");
  lists.replaceChildren(
    ...state.lists.map((l) => {
      const item = navItem(viewOf(l.id), openCount(l.id));
      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        listMenu(l.id, e.clientX, e.clientY);
      });
      return item;
    })
  );
}

function applyTheme(themeKey) {
  const [top, bottom] = THEMES[themeKey] ?? THEMES.blue;
  const root = document.documentElement.style;
  root.setProperty("--bg-top", top);
  root.setProperty("--bg-bottom", bottom);
  root.setProperty("--accent", top);
}

function renderMain() {
  const view = viewOf(state.selected) ?? viewOf("inbox");
  const title = $("#title");
  let tasks;
  if (query) {
    const q = query.toLowerCase();
    title.textContent = `搜索“${query}”`;
    tasks = state.tasks.filter((x) => x.title.toLowerCase().includes(q));
    applyTheme("blue");
  } else {
    title.textContent = view.name;
    tasks = tasksIn(view.id);
    applyTheme(state.themes[view.id] ?? view.theme);
  }
  title.title = view.smart || query ? "" : "点击重命名";

  $("#subtitle").textContent =
    !query && view.id === "myday"
      ? new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })
      : "";
  $("#pin").classList.toggle("on", state.pinned);
  $("#pin").title = state.pinned ? "已置顶：点击取消" : "置顶（覆盖在所有窗口之上）";
  $("#add-form").style.display = query ? "none" : "";

  const open = tasks.filter((x) => !x.done);
  const done = tasks.filter((x) => x.done).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  const box = $("#tasks");
  const nodes = open.map((t) => taskRow(t, view));

  if (done.length) {
    const key = query ? "__search" : view.id;
    const shown = state.showCompleted[key] !== false;
    const toggle = el("button", "section-toggle" + (shown ? "" : " closed"), ICONS.chevron);
    toggle.append(`已完成 ${done.length}`);
    toggle.addEventListener("click", () => {
      state.showCompleted[key] = !shown;
      commit();
    });
    nodes.push(toggle);
    if (shown) nodes.push(...done.map((t) => taskRow(t, view)));
  }
  if (!tasks.length) {
    const empty = el("div", "empty");
    empty.textContent = query ? "没有找到匹配的任务" : "没有任务，去添加一个吧";
    nodes.push(empty);
  }
  box.replaceChildren(...nodes);
}

function formatDue(due) {
  if (due === today()) return "今天";
  if (due === addDays(1)) return "明天";
  if (due === addDays(-1)) return "昨天";
  const [y, m, d] = due.split("-").map(Number);
  return y === new Date().getFullYear() ? `${m}月${d}日` : `${y}年${m}月${d}日`;
}

function taskRow(task, view) {
  const row = el("div", "task" + (task.done ? " done" : ""));
  row.dataset.id = task.id;
  row.draggable = true;

  const check = el("button", "check", ICONS.check);
  check.title = task.done ? "标记为未完成" : "标记为已完成";
  check.addEventListener("click", () => {
    task.done = !task.done;
    task.completedAt = task.done ? Date.now() : null;
    commit();
  });

  const body = el("div", "body");
  const title = el("div", "title");
  title.textContent = task.title;
  const meta = el("div", "meta");
  const inSmart = query || view.smart;
  if (inSmart && !(view.id === "inbox" && task.listId === "inbox" && !query)) {
    const s = el("span");
    s.textContent = listName(task.listId);
    meta.append(s);
  }
  if (task.myDay === today() && view.id !== "myday") meta.append(el("span", "", "☀︎ 我的一天"));
  if (task.due) {
    const s = el("span", !task.done && task.due < today() ? "overdue" : "");
    s.textContent = "📅 " + formatDue(task.due);
    meta.append(s);
  }
  body.append(title, meta);
  body.addEventListener("dblclick", () => editTask(task, title));

  const star = el("button", "star" + (task.important ? " on" : ""), ICONS.star);
  star.title = task.important ? "取消重要" : "标记为重要";
  star.addEventListener("click", () => {
    task.important = !task.important;
    commit();
  });

  const del = el("button", "del", ICONS.x);
  del.title = "删除任务";
  del.addEventListener("click", () => deleteTask(task));

  row.append(check, body, star, del);
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    taskMenu(task, title, e.clientX, e.clientY);
  });
  wireDrag(row, task);
  return row;
}

// ---------- Task editing ----------
function inlineEdit(target, value, className, onDone) {
  const input = el("input", className);
  input.value = value;
  target.replaceChildren(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    const v = input.value.trim();
    onDone(save && v ? v : null);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) finish(true);
    if (e.key === "Escape") finish(false);
    e.stopPropagation();
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("dblclick", (e) => e.stopPropagation());
  return input;
}

function editTask(task, titleNode) {
  inlineEdit(titleNode, task.title, "edit-input", (v) => {
    if (v) task.title = v;
    commit();
  });
}

function deleteTask(task) {
  state.tasks = state.tasks.filter((x) => x !== task);
  commit();
}

// ---------- Drag to reorder / move ----------
let dragTaskId = null;

function wireDrag(row, task) {
  row.addEventListener("dragstart", (e) => {
    dragTaskId = task.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", task.title);
    requestAnimationFrame(() => row.classList.add("dragging"));
  });
  row.addEventListener("dragend", () => {
    dragTaskId = null;
    row.classList.remove("dragging");
    document.querySelectorAll(".drop-before").forEach((n) => n.classList.remove("drop-before"));
  });
  row.addEventListener("dragover", (e) => {
    if (!dragTaskId || dragTaskId === task.id) return;
    e.preventDefault();
    row.classList.add("drop-before");
  });
  row.addEventListener("dragleave", () => row.classList.remove("drop-before"));
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    row.classList.remove("drop-before");
    const from = state.tasks.findIndex((x) => x.id === dragTaskId);
    if (from < 0) return;
    const [moved] = state.tasks.splice(from, 1);
    state.tasks.splice(state.tasks.indexOf(task), 0, moved);
    commit();
  });
}

// ---------- Menus ----------
const menu = $("#menu");

function openMenu(items, x, y) {
  menu.replaceChildren(...items);
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + "px";
  menu.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + "px";
}

function closeMenu() {
  menu.hidden = true;
}

function menuItem(icon, label, action, cls = "") {
  const b = el("button", cls, ICONS[icon] ?? "");
  b.append(label);
  b.addEventListener("click", () => {
    closeMenu();
    action();
  });
  return b;
}

function taskMenu(task, titleNode, x, y) {
  const inMyDay = task.myDay === today();
  const date = el("input");
  date.type = "date";
  date.value = task.due ?? "";
  date.addEventListener("change", () => {
    task.due = date.value || null;
    closeMenu();
    commit();
  });
  const moveTargets = [{ id: "inbox", name: "任务" }, ...state.lists].filter((l) => l.id !== task.listId);
  openMenu(
    [
      menuItem("edit", "重命名", () => editTask(task, titleNode)),
      menuItem("sun", inMyDay ? "从“我的一天”中删除" : "添加到“我的一天”", () => {
        task.myDay = inMyDay ? null : today();
        commit();
      }),
      menuItem("star", task.important ? "取消重要" : "标记为重要", () => {
        task.important = !task.important;
        commit();
      }),
      menuItem("check", task.done ? "标记为未完成" : "标记为已完成", () => {
        task.done = !task.done;
        task.completedAt = task.done ? Date.now() : null;
        commit();
      }),
      el("hr"),
      menuItem("calendar", "今天到期", () => {
        task.due = today();
        commit();
      }),
      menuItem("calendar", "明天到期", () => {
        task.due = addDays(1);
        commit();
      }),
      ...(task.due
        ? [
            menuItem("x", "删除截止日期", () => {
              task.due = null;
              commit();
            }),
          ]
        : []),
      Object.assign(el("div", "menu-label"), { textContent: "选择日期" }),
      date,
      ...(moveTargets.length
        ? [
            el("hr"),
            ...moveTargets.map((l) =>
              menuItem("move", `移动到“${l.name}”`, () => {
                task.listId = l.id;
                commit();
              })
            ),
          ]
        : []),
      el("hr"),
      menuItem("trash", "删除任务", () => deleteTask(task), "danger"),
    ],
    x,
    y
  );
}

function themeSwatches(viewId) {
  const wrap = el("div", "swatches");
  const current = state.themes[viewId] ?? viewOf(viewId).theme;
  for (const [key, [top, bottom]] of Object.entries(THEMES)) {
    const b = el("button", key === current ? "on" : "");
    b.style.background = `linear-gradient(160deg, ${top}, ${bottom})`;
    b.title = key;
    b.addEventListener("click", () => {
      state.themes[viewId] = key;
      closeMenu();
      commit();
    });
    wrap.append(b);
  }
  return wrap;
}

function listMenu(listId, x, y) {
  select(listId);
  openMenu(
    [
      menuItem("edit", "重命名列表", renameCurrentList),
      el("hr"),
      Object.assign(el("div", "menu-label"), { textContent: "主题" }),
      themeSwatches(listId),
      el("hr"),
      menuItem("trash", "删除列表", () => confirmDeleteList(listId), "danger"),
    ],
    x,
    y
  );
}

function moreMenu() {
  const r = $("#more").getBoundingClientRect();
  const view = viewOf(state.selected);
  const key = state.selected;
  const shown = state.showCompleted[key] !== false;
  const items = [];
  if (!view.smart) items.push(menuItem("edit", "重命名列表", renameCurrentList));
  items.push(
    menuItem("eye", shown ? "隐藏已完成的任务" : "显示已完成的任务", () => {
      state.showCompleted[key] = !shown;
      commit();
    }),
    el("hr"),
    Object.assign(el("div", "menu-label"), { textContent: "主题" }),
    themeSwatches(key),
    el("hr"),
    menuItem("dock", state.dockHidden ? "显示 Dock 图标" : "隐藏 Dock 图标（可覆盖全屏应用）", async () => {
      state.dockHidden = !state.dockHidden;
      persist();
      await backend.dock(state.dockHidden);
      // Changing activation policy can reset window level; re-apply pin.
      await backend.pin(state.pinned);
    })
    ,
    menuItem(state.autostart ? "check" : "power", state.autostart ? "开机启动：已开启" : "开机启动：已关闭", async () => {
      state.autostart = !state.autostart;
      persist();
      await backend.autostart(state.autostart).catch((err) => {
        console.error(err);
        state.autostart = !state.autostart;
        persist();
      });
    })
  );
  if (!view.smart) items.push(el("hr"), menuItem("trash", "删除列表", () => confirmDeleteList(key), "danger"));
  openMenu(items, r.right - 260, r.bottom + 6);
  menu.style.left = Math.max(6, r.right - menu.offsetWidth) + "px";
}

// ---------- Lists ----------
function select(id) {
  state.selected = id;
  query = "";
  $("#search").value = "";
  $("#app").classList.remove("drawer");
  commit();
}

function newList() {
  const base = "无标题列表";
  const names = new Set(state.lists.map((l) => l.name));
  let name = base;
  for (let i = 1; names.has(name); i++) name = `${base} (${i})`;
  const list = { id: uid(), name };
  state.lists.push(list);
  select(list.id);
  renameCurrentList();
}

function renameCurrentList() {
  const list = state.lists.find((l) => l.id === state.selected);
  if (!list || query) return;
  const title = $("#title");
  const input = inlineEdit(document.createElement("span"), list.name, "title-input", (v) => {
    if (v) list.name = v;
    input.replaceWith(title);
    commit();
  });
  title.replaceWith(input);
  input.focus();
  input.select();
}

function confirmDeleteList(listId) {
  const list = state.lists.find((l) => l.id === listId);
  if (!list) return;
  const count = state.tasks.filter((t) => t.listId === listId).length;
  $("#modal-text").textContent = `将永久删除“${list.name}”${count ? `及其中的 ${count} 个任务` : ""}，无法撤销。`;
  const modal = $("#modal");
  modal.hidden = false;
  $("#modal-ok").onclick = () => {
    modal.hidden = true;
    state.lists = state.lists.filter((l) => l !== list);
    state.tasks = state.tasks.filter((t) => t.listId !== listId);
    delete state.themes[listId];
    if (state.selected === listId) state.selected = "inbox";
    commit();
  };
  $("#modal-cancel").onclick = () => (modal.hidden = true);
}

// ---------- Add task ----------
function addTask(title) {
  const view = state.selected;
  const task = {
    id: uid(),
    title,
    listId: viewOf(view)?.smart ? "inbox" : view,
    done: false,
    important: view === "important",
    myDay: view === "myday" ? today() : null,
    due: view === "planned" ? today() : null,
    createdAt: Date.now(),
    completedAt: null,
  };
  state.tasks.unshift(task);
  commit();
}

// ---------- Layout ----------
const NARROW = 620;
function updateLayout() {
  const app = $("#app");
  const narrow = innerWidth < NARROW;
  app.classList.toggle("narrow", narrow);
  app.classList.toggle("collapsed", !narrow && state.sidebarCollapsed);
  if (!narrow) app.classList.remove("drawer");
}

// ---------- Wiring ----------
function wire() {
  $("#add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#add-input");
    const v = input.value.trim();
    if (!v) return;
    addTask(v);
    input.value = "";
  });
  $("#add-input").addEventListener("keydown", (e) => {
    if (e.key === "Escape") e.target.blur();
  });

  $("#search").addEventListener("input", (e) => {
    query = e.target.value.trim();
    render();
  });
  $("#search").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.target.value = "";
      query = "";
      e.target.blur();
      render();
    }
  });

  $("#new-list").addEventListener("click", newList);
  $("#title").addEventListener("click", renameCurrentList);
  $("#more").addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden ? moreMenu() : closeMenu();
  });
  $("#pin").addEventListener("click", async () => {
    state.pinned = !state.pinned;
    commit();
    await backend.pin(state.pinned);
  });
  $("#toggle-sidebar").addEventListener("click", () => {
    if (innerWidth < NARROW) $("#app").classList.toggle("drawer");
    else {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      persist();
      updateLayout();
    }
  });
  $("#scrim").addEventListener("click", () => $("#app").classList.remove("drawer"));

  document.addEventListener("mousedown", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !e.target.closest("#more")) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenu();
      $("#modal").hidden = true;
    }
    if (e.metaKey && e.key === "f") {
      e.preventDefault();
      $("#search").focus();
    }
    if (e.metaKey && e.key === "n") {
      e.preventDefault();
      $("#add-input").focus();
    }
  });
  // Block the webview's default context menu (Reload / Inspect).
  document.addEventListener("contextmenu", (e) => {
    if (!e.target.closest("input")) e.preventDefault();
  });
  addEventListener("resize", () => {
    closeMenu();
    updateLayout();
  });
  // Roll over "My Day" / "today" labels at midnight.
  let day = today();
  setInterval(() => {
    if (today() !== day) {
      day = today();
      render();
    }
  }, 60_000);
}

async function init() {
  try {
    const saved = await backend.load();
    if (saved && typeof saved === "object") state = { ...defaultState(), ...saved };
  } catch (err) {
    console.error("load failed", err);
  }
  if (!viewOf(state.selected)) state.selected = "inbox";
  wire();
  updateLayout();
  render();
  await backend.pin(state.pinned).catch(console.error);
  if (state.dockHidden) await backend.dock(true).catch(console.error);
  // Re-register on every launch so the LaunchAgent follows the app if it moved.
  await backend.autostart(state.autostart).catch(console.error);
}

init();
