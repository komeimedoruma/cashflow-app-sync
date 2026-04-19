import React, { useState, useEffect, useMemo, useRef } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { Wallet, TrendingUp, TrendingDown, Plus, Trash2, ArrowRightLeft, Calendar as CalendarIcon, X, Edit3, Check, Upload, ChevronLeft, ChevronRight, Repeat, Copy } from "lucide-react";
import { supabase } from "./supabaseClient";

const CATEGORIES = [
  { id: "sales", label: "売上", type: "in", color: "#3d7a52" },
  { id: "salary", label: "給与", type: "in", color: "#2d5f3f" },
  { id: "other_in", label: "その他収入", type: "in", color: "#5a9e75" },
  { id: "rent", label: "家賃", type: "out", color: "#8b3a3a" },
  { id: "food", label: "食費", type: "out", color: "#a8553e" },
  { id: "utility", label: "光熱費", type: "out", color: "#b87333" },
  { id: "comm", label: "通信費", type: "out", color: "#8a7a3f" },
  { id: "transport", label: "交通費", type: "out", color: "#6b6245" },
  { id: "tax", label: "税金・保険", type: "out", color: "#5a4a3a" },
  { id: "subscription", label: "サブスク", type: "out", color: "#7a5a8a" },
  { id: "salary_pay", label: "給与支払", type: "out", color: "#4a4a6a" },
  { id: "outsourcing", label: "業務委託費", type: "out", color: "#3a5a7a" },
  { id: "cogs", label: "製造原価", type: "out", color: "#6a4a3a" },
  { id: "advertising", label: "広告宣伝費", type: "out", color: "#9a4a6a" },
  { id: "fees", label: "支払手数料", type: "out", color: "#4a6a6a" },
  { id: "loan", label: "返済", type: "out", color: "#5a3a5a" },
  { id: "other_out", label: "その他支出", type: "out", color: "#7a6a5a" },
];

const PERIODS = [
  { id: "1d", label: "1日", days: 1 },
  { id: "1w", label: "1週間", days: 7 },
  { id: "2w", label: "2週間", days: 14 },
  { id: "1m", label: "1ヶ月", days: 30 },
  { id: "3m", label: "3ヶ月", days: 90 },
  { id: "6m", label: "6ヶ月", days: 180 },
  { id: "1y", label: "1年", days: 365 },
];

const STORAGE_KEY = "cashflow-app-v2";

const defaultState = {
  accounts: [
    { id: "a1", name: "メイン口座", balance: 500000 },
    { id: "a2", name: "貯蓄口座", balance: 1000000 },
  ],
  recurring: [],
  entries: [],
  transfers: [],
};

const yen = (n) => (n < 0 ? "-" : "") + "¥" + Math.abs(Math.round(n)).toLocaleString("ja-JP");

const ymd = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const addDays = (d, n) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const uid = () => Math.random().toString(36).slice(2, 10);

// 指定月の「その月の日」を返す。"last"または日数超過時は月末。
function getRecurringDate(year, month, dayOption) {
  if (dayOption === "last") {
    return new Date(year, month + 1, 0); // 翌月0日 = 今月末
  }
  const day = Number(dayOption) || 1;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

function expandRecurring(recurring, from, to) {
  const out = [];
  recurring.forEach((r) => {
    const dayOption = r.dayOfMonth;
    let d = getRecurringDate(from.getFullYear(), from.getMonth(), dayOption);
    if (d < from) {
      d = getRecurringDate(from.getFullYear(), from.getMonth() + 1, dayOption);
    }
    while (d <= to) {
      out.push({
        id: `${r.id}-${ymd(d)}`,
        label: r.label,
        amount: Number(r.amount),
        type: r.type,
        category: r.category,
        date: ymd(d),
        recurring: true,
        recurringId: r.id,
      });
      d = getRecurringDate(d.getFullYear(), d.getMonth() + 1, dayOption);
    }
  });
  return out;
}

export default function CashflowApp() {
  const [state, setState] = useState(defaultState);
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");

  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | error

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("cashflow_data")
          .select("data")
          .eq("id", "main")
          .single();
        if (error) {
          console.error("読み込みエラー:", error);
        } else if (data && data.data) {
          const parsed = data.data;
          if (!parsed.entries) parsed.entries = [];
          setState(parsed);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoaded(true);
      }
    })();

    // リアルタイム同期: 他の端末での更新を自動反映
    const channel = supabase
      .channel("cashflow-changes")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "cashflow_data", filter: "id=eq.main" },
        (payload) => {
          if (payload.new && payload.new.data) {
            const parsed = payload.new.data;
            if (!parsed.entries) parsed.entries = [];
            setState(parsed);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(async () => {
      setSyncStatus("syncing");
      try {
        const { error } = await supabase
          .from("cashflow_data")
          .upsert({ id: "main", data: state, updated_at: new Date().toISOString() });
        if (error) {
          console.error("保存エラー:", error);
          setSyncStatus("error");
        } else {
          setSyncStatus("idle");
        }
      } catch (e) {
        console.error(e);
        setSyncStatus("error");
      }
    }, 500); // 500ms デバウンス(連続変更をまとめる)
    return () => clearTimeout(timer);
  }, [state, loaded]);

  const addAccount = (name, balance) =>
    setState((s) => ({ ...s, accounts: [...s.accounts, { id: uid(), name, balance: Number(balance) || 0 }] }));
  const updateAccount = (id, patch) =>
    setState((s) => ({ ...s, accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  const deleteAccount = (id) => setState((s) => ({ ...s, accounts: s.accounts.filter((a) => a.id !== id) }));

  const addRecurring = (item) => setState((s) => ({ ...s, recurring: [...s.recurring, { id: uid(), ...item }] }));
  const updateRecurring = (id, patch) =>
    setState((s) => ({ ...s, recurring: s.recurring.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const deleteRecurring = (id) => setState((s) => ({ ...s, recurring: s.recurring.filter((r) => r.id !== id) }));

  const addEntry = (item) => setState((s) => ({ ...s, entries: [...s.entries, { id: uid(), ...item }] }));
  const addEntries = (items) =>
    setState((s) => ({ ...s, entries: [...s.entries, ...items.map((i) => ({ id: uid(), ...i }))] }));
  const updateEntry = (id, patch) =>
    setState((s) => ({ ...s, entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const deleteEntry = (id) => setState((s) => ({ ...s, entries: s.entries.filter((r) => r.id !== id) }));

  const addTransfer = (item) =>
    setState((s) => {
      const amt = Number(item.amount || 0);
      const accounts = s.accounts.map((a) => {
        if (a.id === item.from) return { ...a, balance: Number(a.balance) - amt };
        if (a.id === item.to) return { ...a, balance: Number(a.balance) + amt };
        return a;
      });
      return { ...s, accounts, transfers: [...s.transfers, { id: uid(), date: ymd(new Date()), ...item }] };
    });

  if (!loaded) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "#fef3c7" }}
      >
        <div className="text-stone-600 font-serif tracking-wider">読み込み中...</div>
      </div>
    );
  }

  const totalBalance = state.accounts.reduce((s, a) => s + Number(a.balance || 0), 0);

  return (
    <div
      className="min-h-screen"
      style={{
        background: "#fef3c7",
        fontFamily: "'Noto Sans JP', system-ui, sans-serif",
      }}
    >
      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <header className="mb-8 sm:mb-12">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <div className="text-xs tracking-[0.3em] text-stone-500 mb-2 uppercase">Cash Flow Manager</div>
              <h1 className="text-3xl sm:text-5xl font-bold text-stone-800 tracking-tight" style={{ fontFamily: "'Shippori Mincho', 'Noto Serif JP', serif" }}>
                収支の見える化
              </h1>
            </div>
            <div className="text-right">
              <div className="text-xs tracking-widest text-stone-500 mb-1">現在残高合計</div>
              <div className="text-2xl sm:text-3xl font-bold text-stone-800" style={{ fontFamily: "'Shippori Mincho', 'Noto Serif JP', serif" }}>
                {yen(totalBalance)}
              </div>
              <div className="text-xs mt-1 tabular-nums">
                {syncStatus === "syncing" && <span className="text-stone-500">同期中...</span>}
                {syncStatus === "idle" && <span className="text-green-700">✓ 同期済み</span>}
                {syncStatus === "error" && <span className="text-red-700">⚠ 同期エラー</span>}
              </div>
            </div>
          </div>
          <div className="mt-4 h-px bg-gradient-to-r from-stone-400 via-stone-300 to-transparent" />
        </header>

        <nav className="flex gap-1 mb-8 overflow-x-auto pb-1 -mx-1 px-1">
          {[
            { id: "dashboard", label: "ダッシュボード", icon: TrendingUp },
            { id: "calendar", label: "カレンダー", icon: CalendarIcon },
            { id: "entries", label: "入出金", icon: Plus },
            { id: "recurring", label: "定期", icon: Repeat },
            { id: "accounts", label: "口座", icon: Wallet },
            { id: "transfer", label: "振替", icon: ArrowRightLeft },
            { id: "import", label: "インポート", icon: Upload },
          ].map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm whitespace-nowrap transition-all border-b-2 ${
                  active ? "text-stone-900 border-stone-800 font-semibold" : "text-stone-500 border-transparent hover:text-stone-700"
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </nav>

        {activeTab === "dashboard" && <Dashboard state={state} totalBalance={totalBalance} />}
        {activeTab === "calendar" && <CalendarTab state={state} onAdd={addEntry} onUpdate={updateEntry} onDelete={deleteEntry} />}
        {activeTab === "entries" && <EntriesTab entries={state.entries} onAdd={addEntry} onUpdate={updateEntry} onDelete={deleteEntry} />}
        {activeTab === "recurring" && <RecurringTab items={state.recurring} onAdd={addRecurring} onUpdate={updateRecurring} onDelete={deleteRecurring} />}
        {activeTab === "accounts" && <AccountsTab accounts={state.accounts} onAdd={addAccount} onUpdate={updateAccount} onDelete={deleteAccount} />}
        {activeTab === "transfer" && <TransferTab accounts={state.accounts} transfers={state.transfers} onTransfer={addTransfer} />}
        {activeTab === "import" && <ImportTab onAddMany={addEntries} />}

        <footer className="mt-16 pt-6 border-t border-stone-300 text-xs text-stone-400 text-center tracking-wider">
          データはこの端末のブラウザに保存されます
        </footer>
      </div>
    </div>
  );
}

function Dashboard({ state, totalBalance }) {
  const [periodId, setPeriodId] = useState("1m");
  const period = PERIODS.find((p) => p.id === periodId);

  const { dailyData, totalIn, totalOut, endBalance, minBalance } = useMemo(() => {
    const today = startOfDay(new Date());
    const end = addDays(today, period.days - 1);
    const all = [...state.entries, ...expandRecurring(state.recurring, today, end)];

    const days = [];
    for (let i = 0; i < period.days; i++) days.push(addDays(today, i));

    let running = totalBalance;
    const dailyData = days.map((d) => {
      const ds = ymd(d);
      const dayEntries = all.filter((e) => e.date === ds);
      const income = dayEntries.filter((e) => e.type === "in").reduce((s, e) => s + Number(e.amount), 0);
      const expense = dayEntries.filter((e) => e.type === "out").reduce((s, e) => s + Number(e.amount), 0);
      running += income - expense;
      return { date: d, ds, income, expense, net: income - expense, balance: running, entries: dayEntries };
    });

    return {
      dailyData,
      totalIn: dailyData.reduce((s, d) => s + d.income, 0),
      totalOut: dailyData.reduce((s, d) => s + d.expense, 0),
      endBalance: dailyData[dailyData.length - 1]?.balance ?? totalBalance,
      minBalance: Math.min(totalBalance, ...dailyData.map((d) => d.balance)),
    };
  }, [state, period, totalBalance]);

  const chartData = useMemo(() => {
    if (period.days <= 31) {
      return dailyData.map((d) => ({
        name: `${d.date.getMonth() + 1}/${d.date.getDate()}`,
        残高: Math.round(d.balance),
        収入: Math.round(d.income),
        支出: Math.round(d.expense),
      }));
    } else if (period.days <= 180) {
      const weeks = [];
      for (let i = 0; i < dailyData.length; i += 7) {
        const chunk = dailyData.slice(i, i + 7);
        const last = chunk[chunk.length - 1];
        weeks.push({
          name: `${last.date.getMonth() + 1}/${last.date.getDate()}`,
          残高: Math.round(last.balance),
          収入: Math.round(chunk.reduce((s, d) => s + d.income, 0)),
          支出: Math.round(chunk.reduce((s, d) => s + d.expense, 0)),
        });
      }
      return weeks;
    } else {
      const months = {};
      dailyData.forEach((d) => {
        const mk = `${d.date.getFullYear()}-${d.date.getMonth()}`;
        if (!months[mk]) months[mk] = { date: d.date, income: 0, expense: 0, lastBalance: d.balance };
        months[mk].income += d.income;
        months[mk].expense += d.expense;
        months[mk].lastBalance = d.balance;
      });
      return Object.values(months).map((m) => ({
        name: `${m.date.getFullYear()}/${m.date.getMonth() + 1}`,
        残高: Math.round(m.lastBalance),
        収入: Math.round(m.income),
        支出: Math.round(m.expense),
      }));
    }
  }, [dailyData, period]);

  return (
    <div className="space-y-6">
      <div className="flex gap-1 overflow-x-auto pb-1">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriodId(p.id)}
            className={`px-3 py-1.5 text-xs whitespace-nowrap border transition-colors ${
              periodId === p.id ? "bg-stone-800 text-stone-50 border-stone-800" : "bg-white text-stone-600 border-stone-300 hover:border-stone-500"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label={`${period.label}後の残高`} value={yen(endBalance)} tone={endBalance >= totalBalance ? "pos" : "neg"} />
        <StatCard label="期間中の最低残高" value={yen(minBalance)} tone={minBalance >= 0 ? "neutral" : "neg"} />
        <StatCard label={`${period.label}の収入計`} value={yen(totalIn)} tone="pos" />
        <StatCard label={`${period.label}の支出計`} value={yen(totalOut)} tone="neg" />
      </div>

      {minBalance < 0 && (
        <div className="border-l-4 border-red-800 bg-red-50/70 px-4 py-3 text-sm text-red-900">
          <strong>⚠ 注意:</strong> この期間中に残高がマイナスになる日があります。
        </div>
      )}

      <Panel title="残高推移">
        <div className="h-64 sm:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="#d6cfbf" />
              <XAxis dataKey="name" stroke="#78716c" fontSize={11} />
              <YAxis stroke="#78716c" fontSize={11} tickFormatter={(v) => `${Math.round(v / 10000)}万`} />
              <Tooltip formatter={(v) => yen(v)} contentStyle={{ background: "#faf7ed", border: "1px solid #a8a29e", borderRadius: 0, fontSize: 12 }} />
              <ReferenceLine y={0} stroke="#991b1b" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="残高" stroke="#2d5f3f" strokeWidth={2.5} dot={{ fill: "#2d5f3f", r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel title="収支バランス">
        <div className="h-56 sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="#d6cfbf" />
              <XAxis dataKey="name" stroke="#78716c" fontSize={11} />
              <YAxis stroke="#78716c" fontSize={11} tickFormatter={(v) => `${Math.round(v / 10000)}万`} />
              <Tooltip formatter={(v) => yen(v)} contentStyle={{ background: "#faf7ed", border: "1px solid #a8a29e", borderRadius: 0, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="収入" fill="#3d7a52" />
              <Bar dataKey="支出" fill="#8b3a3a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      {period.days <= 31 && (
        <Panel title="日別明細">
          <div className="overflow-x-auto -mx-5 sm:mx-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-stone-500 border-b border-stone-300">
                  <th className="text-left py-2 px-3 font-normal tracking-wider">日付</th>
                  <th className="text-right py-2 px-3 font-normal tracking-wider">収入</th>
                  <th className="text-right py-2 px-3 font-normal tracking-wider">支出</th>
                  <th className="text-right py-2 px-3 font-normal tracking-wider">収支</th>
                  <th className="text-right py-2 px-3 font-normal tracking-wider">残高</th>
                </tr>
              </thead>
              <tbody>
                {dailyData
                  .filter((d) => d.income !== 0 || d.expense !== 0 || period.days <= 14)
                  .map((d) => {
                    const dow = ["日", "月", "火", "水", "木", "金", "土"][d.date.getDay()];
                    return (
                      <tr key={d.ds} className="border-b border-stone-200/60 hover:bg-stone-100/40">
                        <td className="py-2 px-3 text-stone-700 tabular-nums">
                          {d.date.getMonth() + 1}/{d.date.getDate()}({dow})
                        </td>
                        <td className="py-2 px-3 text-right text-green-800 tabular-nums">{d.income ? yen(d.income) : "—"}</td>
                        <td className="py-2 px-3 text-right text-red-800 tabular-nums">{d.expense ? yen(d.expense) : "—"}</td>
                        <td className={`py-2 px-3 text-right tabular-nums font-semibold ${d.net > 0 ? "text-green-800" : d.net < 0 ? "text-red-800" : "text-stone-400"}`}>
                          {d.net > 0 ? "+" : ""}
                          {d.net !== 0 ? yen(d.net) : "—"}
                        </td>
                        <td className={`py-2 px-3 text-right tabular-nums font-semibold ${d.balance < 0 ? "text-red-800" : "text-stone-800"}`}>{yen(d.balance)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

function CalendarTab({ state, onAdd, onUpdate, onDelete }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(null);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState(null);

  const startEdit = (e) => {
    setEditId(e.id);
    setEditForm({ label: e.label, amount: String(e.amount), type: e.type, category: e.category, date: e.date });
  };
  const saveEdit = () => {
    if (!editForm.label.trim() || !editForm.amount) return;
    onUpdate(editId, {
      label: editForm.label.trim(),
      amount: Number(editForm.amount),
      type: editForm.type,
      category: editForm.category,
      date: editForm.date,
    });
    setEditId(null);
    setEditForm(null);
  };
  const cancelEdit = () => {
    setEditId(null);
    setEditForm(null);
  };

  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);

  const cells = useMemo(() => {
    const start = new Date(monthStart);
    start.setDate(start.getDate() - start.getDay());
    const result = [];
    for (let i = 0; i < 42; i++) result.push(addDays(start, i));
    return result;
  }, [cursor]);

  const allEntries = useMemo(() => {
    const today = startOfDay(new Date());
    const from = monthStart < today ? monthStart : today;
    const to = new Date(monthEnd.getFullYear(), monthEnd.getMonth() + 1, 0);
    return [...state.entries, ...expandRecurring(state.recurring, from, to)];
  }, [state, cursor]);

  const byDate = useMemo(() => {
    const map = {};
    allEntries.forEach((e) => {
      if (!map[e.date]) map[e.date] = { income: 0, expense: 0, items: [] };
      if (e.type === "in") map[e.date].income += Number(e.amount);
      else map[e.date].expense += Number(e.amount);
      map[e.date].items.push(e);
    });
    return map;
  }, [allEntries]);

  const monthPrefix = ymd(monthStart).slice(0, 7);
  const monthlyIn = Object.entries(byDate).filter(([d]) => d.startsWith(monthPrefix)).reduce((s, [, v]) => s + v.income, 0);
  const monthlyOut = Object.entries(byDate).filter(([d]) => d.startsWith(monthPrefix)).reduce((s, [, v]) => s + v.expense, 0);

  const selectedData = selectedDate ? byDate[selectedDate] : null;

  return (
    <div className="space-y-6">
      <Panel title="">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="p-2 text-stone-600 hover:text-stone-900">
            <ChevronLeft size={18} />
          </button>
          <div className="text-xl sm:text-2xl font-bold text-stone-800" style={{ fontFamily: "'Shippori Mincho', 'Noto Serif JP', serif" }}>
            {cursor.getFullYear()}年{cursor.getMonth() + 1}月
          </div>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="p-2 text-stone-600 hover:text-stone-900">
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
          <div className="flex items-center justify-between bg-green-50/70 border border-green-900/20 px-3 py-2">
            <span className="text-stone-600">今月の収入</span>
            <span className="tabular-nums font-semibold text-green-800">{yen(monthlyIn)}</span>
          </div>
          <div className="flex items-center justify-between bg-red-50/70 border border-red-900/20 px-3 py-2">
            <span className="text-stone-600">今月の支出</span>
            <span className="tabular-nums font-semibold text-red-800">{yen(monthlyOut)}</span>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px bg-stone-300">
          {["日", "月", "火", "水", "木", "金", "土"].map((d, i) => (
            <div key={d} className={`bg-stone-100 text-center py-1.5 text-xs font-medium ${i === 0 ? "text-red-700" : i === 6 ? "text-blue-700" : "text-stone-600"}`}>
              {d}
            </div>
          ))}
          {cells.map((d, i) => {
            const ds = ymd(d);
            const data = byDate[ds];
            const isCurrentMonth = d.getMonth() === cursor.getMonth();
            const isToday = sameDay(d, new Date());
            const isSelected = selectedDate === ds;
            const hasData = data && (data.income > 0 || data.expense > 0);

            return (
              <button
                key={i}
                onClick={() => setSelectedDate(ds)}
                className={`bg-white min-h-[60px] sm:min-h-[80px] p-1 sm:p-2 text-left transition-colors ${!isCurrentMonth ? "opacity-30" : ""} ${
                  isSelected ? "ring-2 ring-stone-800 ring-inset" : ""
                } ${isToday ? "bg-amber-50" : ""} hover:bg-stone-50`}
              >
                <div className={`text-xs mb-0.5 tabular-nums ${d.getDay() === 0 ? "text-red-700" : d.getDay() === 6 ? "text-blue-700" : "text-stone-700"} ${isToday ? "font-bold" : ""}`}>
                  {d.getDate()}
                </div>
                {hasData && (
                  <div className="space-y-0.5">
                    {data.income > 0 && <div className="text-[9px] sm:text-[10px] text-green-800 tabular-nums truncate">+{yen(data.income).replace("¥", "")}</div>}
                    {data.expense > 0 && <div className="text-[9px] sm:text-[10px] text-red-800 tabular-nums truncate">−{yen(data.expense).replace("¥", "")}</div>}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </Panel>

      {selectedDate && (
        <Panel title={`${selectedDate.replace(/-/g, "/")}の内訳`}>
          {selectedData && selectedData.items.length > 0 ? (
            <div className="space-y-2">
              {selectedData.items.map((e) => {
                const cat = CATEGORIES.find((c) => c.id === e.category);
                if (editId === e.id) {
                  const editCats = CATEGORIES.filter((c) => c.type === editForm.type);
                  return (
                    <div key={e.id} className="p-3 bg-amber-50/60 border border-amber-900/30 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <SegButton active={editForm.type === "in"} onClick={() => setEditForm({ ...editForm, type: "in", category: "sales" })} tone="pos">
                          <TrendingUp size={14} /> 収入
                        </SegButton>
                        <SegButton active={editForm.type === "out"} onClick={() => setEditForm({ ...editForm, type: "out", category: "other_out" })} tone="neg">
                          <TrendingDown size={14} /> 支出
                        </SegButton>
                      </div>
                      <Input placeholder="項目名" value={editForm.label} onChange={(v) => setEditForm({ ...editForm, label: v })} />
                      <div className="grid grid-cols-2 gap-2">
                        <Input type="number" placeholder="金額" value={editForm.amount} onChange={(v) => setEditForm({ ...editForm, amount: v })} />
                        <Select value={editForm.category} onChange={(v) => setEditForm({ ...editForm, category: v })}>
                          {editCats.map((c) => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                          ))}
                        </Select>
                      </div>
                      <Input type="date" value={editForm.date} onChange={(v) => setEditForm({ ...editForm, date: v })} />
                      <div className="flex gap-2">
                        <Button onClick={saveEdit} full>
                          <Check size={14} /> 保存
                        </Button>
                        <button onClick={cancelEdit} className="px-4 py-2.5 bg-white border border-stone-300 text-stone-700 text-sm hover:bg-stone-50">
                          キャンセル
                        </button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={e.id} className="flex items-center gap-3 p-3 bg-stone-50/60 border border-stone-200">
                    <div className="w-1 self-stretch" style={{ background: cat?.color || "#999" }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-stone-800 font-medium truncate">
                        {e.label}
                        {e.recurring && <span className="ml-2 text-xs text-stone-400">(定期)</span>}
                      </div>
                      <div className="text-xs text-stone-500">{cat?.label}</div>
                    </div>
                    <div className={`tabular-nums font-semibold ${e.type === "in" ? "text-green-800" : "text-red-800"}`}>
                      {e.type === "in" ? "+" : "−"}
                      {yen(e.amount)}
                    </div>
                    <IconBtn
                      onClick={() => {
                        onAdd({
                          label: e.label,
                          amount: Number(e.amount),
                          type: e.type,
                          category: e.category,
                          date: e.date,
                        });
                      }}
                    >
                      <Copy size={14} />
                    </IconBtn>
                    {!e.recurring && (
                      <>
                        <IconBtn onClick={() => startEdit(e)}>
                          <Edit3 size={14} />
                        </IconBtn>
                        <IconBtn onClick={() => onDelete(e.id)} danger>
                          <Trash2 size={14} />
                        </IconBtn>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty>この日の予定はありません</Empty>
          )}
        </Panel>
      )}
    </div>
  );
}

function EntriesTab({ entries, onAdd, onUpdate, onDelete }) {
  const [form, setForm] = useState({ label: "", amount: "", type: "out", category: "other_out", date: ymd(new Date()) });
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState(null);

  const handleAdd = () => {
    if (!form.label.trim() || !form.amount) return;
    onAdd({ label: form.label.trim(), amount: Number(form.amount), type: form.type, category: form.category, date: form.date });
    setForm({ ...form, label: "", amount: "" });
  };

  const startEdit = (e) => {
    setEditId(e.id);
    setEditForm({ label: e.label, amount: String(e.amount), type: e.type, category: e.category, date: e.date });
  };
  const saveEdit = () => {
    if (!editForm.label.trim() || !editForm.amount) return;
    onUpdate(editId, {
      label: editForm.label.trim(),
      amount: Number(editForm.amount),
      type: editForm.type,
      category: editForm.category,
      date: editForm.date,
    });
    setEditId(null);
    setEditForm(null);
  };
  const cancelEdit = () => {
    setEditId(null);
    setEditForm(null);
  };

  const filteredCategories = CATEGORIES.filter((c) => c.type === form.type);
  const sortedEntries = [...entries].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-6">
      <Panel title="入出金の登録" subtitle="特定の日付の単発の入出金">
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <SegButton active={form.type === "in"} onClick={() => setForm({ ...form, type: "in", category: "sales" })} tone="pos">
              <TrendingUp size={14} /> 収入
            </SegButton>
            <SegButton active={form.type === "out"} onClick={() => setForm({ ...form, type: "out", category: "other_out" })} tone="neg">
              <TrendingDown size={14} /> 支出
            </SegButton>
          </div>
          <Input placeholder="項目名" value={form.label} onChange={(v) => setForm({ ...form, label: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" placeholder="金額" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
            <Select value={form.category} onChange={(v) => setForm({ ...form, category: v })}>
              {filteredCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </Select>
          </div>
          <Input type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
          <Button onClick={handleAdd} full>
            <Plus size={14} /> 追加
          </Button>
        </div>
      </Panel>

      <Panel title={`登録済み (${entries.length}件)`}>
        {entries.length === 0 ? (
          <Empty>まだ登録がありません</Empty>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {sortedEntries.map((e) => {
              const cat = CATEGORIES.find((c) => c.id === e.category);
              if (editId === e.id) {
                const editCats = CATEGORIES.filter((c) => c.type === editForm.type);
                return (
                  <div key={e.id} className="p-3 bg-amber-50/60 border border-amber-900/30 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <SegButton active={editForm.type === "in"} onClick={() => setEditForm({ ...editForm, type: "in", category: "sales" })} tone="pos">
                        <TrendingUp size={14} /> 収入
                      </SegButton>
                      <SegButton active={editForm.type === "out"} onClick={() => setEditForm({ ...editForm, type: "out", category: "other_out" })} tone="neg">
                        <TrendingDown size={14} /> 支出
                      </SegButton>
                    </div>
                    <Input placeholder="項目名" value={editForm.label} onChange={(v) => setEditForm({ ...editForm, label: v })} />
                    <div className="grid grid-cols-2 gap-2">
                      <Input type="number" placeholder="金額" value={editForm.amount} onChange={(v) => setEditForm({ ...editForm, amount: v })} />
                      <Select value={editForm.category} onChange={(v) => setEditForm({ ...editForm, category: v })}>
                        {editCats.map((c) => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </Select>
                    </div>
                    <Input type="date" value={editForm.date} onChange={(v) => setEditForm({ ...editForm, date: v })} />
                    <div className="flex gap-2">
                      <Button onClick={saveEdit} full>
                        <Check size={14} /> 保存
                      </Button>
                      <button onClick={cancelEdit} className="px-4 py-2.5 bg-white border border-stone-300 text-stone-700 text-sm hover:bg-stone-50">
                        キャンセル
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={e.id} className="flex items-center gap-3 p-3 bg-stone-50/60 border border-stone-200">
                  <div className="w-1 self-stretch" style={{ background: cat?.color || "#999" }} />
                  <div className="text-xs text-stone-500 shrink-0 tabular-nums w-16">{e.date.slice(5).replace("-", "/")}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-stone-800 font-medium truncate">{e.label}</div>
                    <div className="text-xs text-stone-500">{cat?.label}</div>
                  </div>
                  <div className={`tabular-nums font-semibold ${e.type === "in" ? "text-green-800" : "text-red-800"}`}>
                    {e.type === "in" ? "+" : "−"}
                    {yen(e.amount)}
                  </div>
                  <IconBtn onClick={() => startEdit(e)}>
                    <Edit3 size={14} />
                  </IconBtn>
                  <IconBtn onClick={() => onDelete(e.id)} danger>
                    <Trash2 size={14} />
                  </IconBtn>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

function RecurringTab({ items, onAdd, onUpdate, onDelete }) {
  const [form, setForm] = useState({ label: "", amount: "", type: "out", category: "food", dayOfMonth: 25 });
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState(null);

  const handleAdd = () => {
    if (!form.label.trim() || !form.amount) return;
    onAdd({ label: form.label.trim(), amount: Number(form.amount), type: form.type, category: form.category, dayOfMonth: form.dayOfMonth === "last" ? "last" : Number(form.dayOfMonth) });
    setForm({ ...form, label: "", amount: "" });
  };

  const startEdit = (r) => {
    setEditId(r.id);
    setEditForm({ label: r.label, amount: String(r.amount), type: r.type, category: r.category, dayOfMonth: r.dayOfMonth });
  };
  const saveEdit = () => {
    if (!editForm.label.trim() || !editForm.amount) return;
    onUpdate(editId, {
      label: editForm.label.trim(),
      amount: Number(editForm.amount),
      type: editForm.type,
      category: editForm.category,
      dayOfMonth: editForm.dayOfMonth === "last" ? "last" : Number(editForm.dayOfMonth),
    });
    setEditId(null);
    setEditForm(null);
  };
  const cancelEdit = () => {
    setEditId(null);
    setEditForm(null);
  };

  const filteredCategories = CATEGORIES.filter((c) => c.type === form.type);

  return (
    <div className="space-y-6">
      <Panel title="定期入出金" subtitle="毎月決まった日に発生する入出金">
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <SegButton active={form.type === "in"} onClick={() => setForm({ ...form, type: "in", category: "salary" })} tone="pos">
              <TrendingUp size={14} /> 収入
            </SegButton>
            <SegButton active={form.type === "out"} onClick={() => setForm({ ...form, type: "out", category: "food" })} tone="neg">
              <TrendingDown size={14} /> 支出
            </SegButton>
          </div>
          <Input placeholder="項目名(例:家賃、給与)" value={form.label} onChange={(v) => setForm({ ...form, label: v })} />
          <div className="grid grid-cols-3 gap-2">
            <Input type="number" placeholder="金額" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
            <Select value={form.category} onChange={(v) => setForm({ ...form, category: v })}>
              {filteredCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </Select>
            <Select value={form.dayOfMonth} onChange={(v) => setForm({ ...form, dayOfMonth: v })}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>毎月{d}日</option>
              ))}
              <option value={29}>毎月29日(ない月は月末)</option>
              <option value={30}>毎月30日(ない月は月末)</option>
              <option value={31}>毎月31日(ない月は月末)</option>
              <option value="last">毎月末</option>
            </Select>
          </div>
          <Button onClick={handleAdd} full>
            <Plus size={14} /> 追加
          </Button>
        </div>
      </Panel>

      <Panel title={`定期 (${items.length}件)`}>
        {items.length === 0 ? (
          <Empty>毎月の入出金を登録しましょう</Empty>
        ) : (
          <div className="space-y-2">
            {items.map((r) => {
              const cat = CATEGORIES.find((c) => c.id === r.category);
              if (editId === r.id) {
                const editCats = CATEGORIES.filter((c) => c.type === editForm.type);
                return (
                  <div key={r.id} className="p-3 bg-amber-50/60 border border-amber-900/30 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <SegButton active={editForm.type === "in"} onClick={() => setEditForm({ ...editForm, type: "in", category: "salary" })} tone="pos">
                        <TrendingUp size={14} /> 収入
                      </SegButton>
                      <SegButton active={editForm.type === "out"} onClick={() => setEditForm({ ...editForm, type: "out", category: "food" })} tone="neg">
                        <TrendingDown size={14} /> 支出
                      </SegButton>
                    </div>
                    <Input placeholder="項目名" value={editForm.label} onChange={(v) => setEditForm({ ...editForm, label: v })} />
                    <div className="grid grid-cols-3 gap-2">
                      <Input type="number" placeholder="金額" value={editForm.amount} onChange={(v) => setEditForm({ ...editForm, amount: v })} />
                      <Select value={editForm.category} onChange={(v) => setEditForm({ ...editForm, category: v })}>
                        {editCats.map((c) => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </Select>
                      <Select value={editForm.dayOfMonth} onChange={(v) => setEditForm({ ...editForm, dayOfMonth: v })}>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                          <option key={d} value={d}>毎月{d}日</option>
                        ))}
                        <option value={29}>毎月29日(ない月は月末)</option>
                        <option value={30}>毎月30日(ない月は月末)</option>
                        <option value={31}>毎月31日(ない月は月末)</option>
                        <option value="last">毎月末</option>
                      </Select>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={saveEdit} full>
                        <Check size={14} /> 保存
                      </Button>
                      <button onClick={cancelEdit} className="px-4 py-2.5 bg-white border border-stone-300 text-stone-700 text-sm hover:bg-stone-50">
                        キャンセル
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={r.id} className="flex items-center gap-3 p-3 bg-stone-50/60 border border-stone-200">
                  <div className="w-1 self-stretch" style={{ background: cat?.color || "#999" }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-stone-800 font-medium truncate">{r.label}</div>
                    <div className="text-xs text-stone-500">{cat?.label} ・ {r.dayOfMonth === "last" ? "毎月末" : `毎月${r.dayOfMonth}日`}</div>
                  </div>
                  <div className={`tabular-nums font-semibold ${r.type === "in" ? "text-green-800" : "text-red-800"}`}>
                    {r.type === "in" ? "+" : "−"}
                    {yen(r.amount)}
                  </div>
                  <IconBtn onClick={() => startEdit(r)}>
                    <Edit3 size={14} />
                  </IconBtn>
                  <IconBtn onClick={() => onDelete(r.id)} danger>
                    <Trash2 size={14} />
                  </IconBtn>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

function AccountsTab({ accounts, onAdd, onUpdate, onDelete }) {
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("");
  const [editId, setEditId] = useState(null);
  const [editVals, setEditVals] = useState({ name: "", balance: "" });

  const handleAdd = () => {
    if (!name.trim()) return;
    onAdd(name.trim(), balance);
    setName("");
    setBalance("");
  };

  return (
    <div className="space-y-6">
      <Panel title="口座の追加">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
          <Input placeholder="口座名" value={name} onChange={setName} />
          <Input placeholder="現在残高" type="number" value={balance} onChange={setBalance} />
          <Button onClick={handleAdd}>
            <Plus size={14} /> 追加
          </Button>
        </div>
      </Panel>

      <Panel title={`口座一覧 (${accounts.length}件)`}>
        {accounts.length === 0 ? (
          <Empty>まだ口座がありません</Empty>
        ) : (
          <div className="space-y-2">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center gap-3 p-3 bg-stone-50/60 border border-stone-200">
                {editId === a.id ? (
                  <>
                    <Input value={editVals.name} onChange={(v) => setEditVals({ ...editVals, name: v })} />
                    <Input type="number" value={editVals.balance} onChange={(v) => setEditVals({ ...editVals, balance: v })} />
                    <IconBtn onClick={() => { onUpdate(a.id, { name: editVals.name, balance: Number(editVals.balance) || 0 }); setEditId(null); }}>
                      <Check size={14} />
                    </IconBtn>
                    <IconBtn onClick={() => setEditId(null)}>
                      <X size={14} />
                    </IconBtn>
                  </>
                ) : (
                  <>
                    <Wallet size={16} className="text-stone-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-stone-800 font-medium truncate">{a.name}</div>
                    </div>
                    <div className="tabular-nums text-stone-800 font-semibold">{yen(a.balance)}</div>
                    <IconBtn onClick={() => { setEditId(a.id); setEditVals({ name: a.name, balance: a.balance }); }}>
                      <Edit3 size={14} />
                    </IconBtn>
                    <IconBtn onClick={() => onDelete(a.id)} danger>
                      <Trash2 size={14} />
                    </IconBtn>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function TransferTab({ accounts, transfers, onTransfer }) {
  const [form, setForm] = useState({ from: "", to: "", amount: "", note: "" });

  useEffect(() => {
    if (accounts.length >= 2 && !form.from) {
      setForm((f) => ({ ...f, from: accounts[0].id, to: accounts[1].id }));
    }
  }, [accounts]);

  const handleTransfer = () => {
    if (!form.from || !form.to || form.from === form.to || !form.amount) return;
    onTransfer({ from: form.from, to: form.to, amount: Number(form.amount), note: form.note });
    setForm({ ...form, amount: "", note: "" });
  };

  if (accounts.length < 2) {
    return (
      <Panel title="口座間の振替">
        <Empty>振替には2つ以上の口座が必要です</Empty>
      </Panel>
    );
  }

  const recentTransfers = [...transfers].reverse().slice(0, 20);

  return (
    <div className="space-y-6">
      <Panel title="口座間の振替">
        <div className="space-y-2">
          <div>
            <label className="text-xs text-stone-500 tracking-wider block mb-1">FROM</label>
            <Select value={form.from} onChange={(v) => setForm({ ...form, from: v })}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}({yen(a.balance)})</option>
              ))}
            </Select>
          </div>
          <div className="flex justify-center py-1">
            <ArrowRightLeft className="text-stone-400 rotate-90" size={18} />
          </div>
          <div>
            <label className="text-xs text-stone-500 tracking-wider block mb-1">TO</label>
            <Select value={form.to} onChange={(v) => setForm({ ...form, to: v })}>
              {accounts.filter((a) => a.id !== form.from).map((a) => (
                <option key={a.id} value={a.id}>{a.name}({yen(a.balance)})</option>
              ))}
            </Select>
          </div>
          <Input type="number" placeholder="金額" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
          <Input placeholder="メモ(任意)" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />
          <Button onClick={handleTransfer} full>
            <ArrowRightLeft size={14} /> 振替
          </Button>
        </div>
      </Panel>

      {recentTransfers.length > 0 && (
        <Panel title="振替履歴">
          <div className="space-y-2">
            {recentTransfers.map((t) => {
              const from = accounts.find((a) => a.id === t.from);
              const to = accounts.find((a) => a.id === t.to);
              return (
                <div key={t.id} className="flex items-center gap-3 p-3 bg-stone-50/60 border border-stone-200 text-sm">
                  <div className="text-xs text-stone-500 shrink-0 tabular-nums w-16">{t.date.slice(5).replace("-", "/")}</div>
                  <div className="flex-1 min-w-0 truncate">
                    <span className="text-stone-700">{from?.name || "?"}</span>
                    <span className="mx-2 text-stone-400">→</span>
                    <span className="text-stone-700">{to?.name || "?"}</span>
                    {t.note && <span className="text-stone-500 ml-2 text-xs">({t.note})</span>}
                  </div>
                  <div className="tabular-nums font-semibold text-stone-800">{yen(t.amount)}</div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}

function ImportTab({ onAddMany }) {
  const [rawText, setRawText] = useState("");
  const [preview, setPreview] = useState([]);
  const [error, setError] = useState("");
  const [defaultType, setDefaultType] = useState("auto"); // auto / in / out
  const fileRef = useRef(null);

  const detectCategory = (label, type) => {
    if (/給与|給料/i.test(label)) return type === "in" ? "salary" : "salary_pay";
    if (/売上|売り上げ|入金|振込入金/i.test(label)) return "sales";
    if (/家賃|賃料|テナント/i.test(label)) return "rent";
    if (/電気|ガス|水道|光熱/i.test(label)) return "utility";
    if (/通信|携帯|wifi|ネット/i.test(label)) return "comm";
    if (/交通|電車|タクシー|ガソリン/i.test(label)) return "transport";
    if (/税|保険|年金|公庫/i.test(label)) return "tax";
    if (/サブスク|canva|zoom|google|chatwork|slack/i.test(label)) return "subscription";
    if (/業務委託|外注|委託費|フリーランス/i.test(label)) return "outsourcing";
    if (/製造原価|原価|仕入|材料|製造/i.test(label)) return "cogs";
    if (/広告|宣伝|プロモ|ad|google\s*ads|facebook\s*ads|広告費/i.test(label)) return "advertising";
    if (/手数料|振込|送金料|決済手数|stripe|square|paypal/i.test(label)) return "fees";
    if (/返済|ローン/i.test(label)) return "loan";
    return type === "in" ? "other_in" : "other_out";
  };

  const parseText = (text) => {
    const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return [];

    const firstLine = lines[0];
    const delim = firstLine.includes("\t") ? "\t" : ",";

    const headerCandidate = lines[0].split(delim).map((s) => s.trim().replace(/^["']|["']$/g, ""));
    const hasHeader = headerCandidate.some((h) => /日付|date|金額|amount|項目|内容|メモ|摘要|入金|出金|収入|支出/i.test(h));

    const dataLines = hasHeader ? lines.slice(1) : lines;
    const headers = hasHeader ? headerCandidate : null;

    let dateIdx = 0, labelIdx = 1, amountIdx = 2;
    let inIdx = -1, outIdx = -1; // 入金列/出金列が分かれているパターン
    if (headers) {
      headers.forEach((h, i) => {
        if (/日付|date|発生日|取引日/i.test(h)) dateIdx = i;
        else if (/項目|内容|摘要|品目|取引|メモ/i.test(h)) labelIdx = i;
        else if (/入金|収入/i.test(h) && !/出金|支出/.test(h)) inIdx = i;
        else if (/出金|支出/i.test(h) && !/入金|収入/.test(h)) outIdx = i;
        else if (/金額|amount/i.test(h) && amountIdx === 2) amountIdx = i;
      });
    }

    const parsed = [];
    dataLines.forEach((line) => {
      const cols = line.split(delim).map((s) => s.trim().replace(/^["']|["']$/g, ""));
      if (cols.length < 2) return;

      const dateStr = cols[dateIdx] || "";
      const label = cols[labelIdx] || "";

      const dateParts = dateStr.match(/(\d{4})[-/.年]+(\d{1,2})[-/.月]+(\d{1,2})/);
      if (!dateParts) return;
      const date = `${dateParts[1]}-${String(dateParts[2]).padStart(2, "0")}-${String(dateParts[3]).padStart(2, "0")}`;

      let amount = 0;
      let type = "out";

      if (inIdx >= 0 || outIdx >= 0) {
        // 入金列/出金列が分かれているケース
        const inAmt = inIdx >= 0 ? Math.abs(Number((cols[inIdx] || "").replace(/[¥,\s円]/g, ""))) : 0;
        const outAmt = outIdx >= 0 ? Math.abs(Number((cols[outIdx] || "").replace(/[¥,\s円]/g, ""))) : 0;
        if (inAmt > 0) {
          type = "in";
          amount = inAmt;
        } else if (outAmt > 0) {
          type = "out";
          amount = outAmt;
        } else {
          return;
        }
      } else {
        // 金額1列のケース
        const amountRaw = cols[amountIdx] || "";
        const amountStr = amountRaw.replace(/[¥,\s円]/g, "");
        amount = Math.abs(Number(amountStr));
        if (!amount || isNaN(amount)) return;

        if (defaultType === "in") type = "in";
        else if (defaultType === "out") type = "out";
        else {
          // auto: マイナス = 支出、プラス = 項目名から推測 or 支出
          if (amountStr.startsWith("-") || amountRaw.startsWith("-")) type = "out";
          else if (/売上|入金|給与|給料|報酬|還付|収入|振込入金/i.test(label)) type = "in";
          else type = "out";
        }
      }

      const category = detectCategory(label, type);
      parsed.push({ date, label, amount, type, category });
    });
    return parsed;
  };

  const handleParse = () => {
    setError("");
    try {
      const result = parseText(rawText);
      if (result.length === 0) {
        setError("取り込める行が見つかりませんでした。形式をご確認ください。");
        setPreview([]);
        return;
      }
      setPreview(result);
    } catch (e) {
      setError("パースに失敗しました: " + e.message);
      setPreview([]);
    }
  };

  const handleImport = () => {
    if (preview.length === 0) return;
    onAddMany(preview);
    setPreview([]);
    setRawText("");
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setRawText(ev.target.result || "");
    reader.readAsText(file, "UTF-8");
  };

  const updatePreviewRow = (idx, patch) => {
    setPreview((p) => p.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };
  const deletePreviewRow = (idx) => {
    setPreview((p) => p.filter((_, i) => i !== idx));
  };
  const setAllType = (type) => {
    setPreview((p) =>
      p.map((row) => ({
        ...row,
        type,
        category: detectCategory(row.label, type),
      }))
    );
  };

  return (
    <div className="space-y-6">
      <Panel title="CSVインポート" subtitle="freee/マネーフォワード/スプレッドシートから書き出したCSVを取り込めます">
        <div className="space-y-3">
          <div className="bg-amber-50/60 border border-amber-900/20 p-3 text-xs text-stone-700 space-y-1">
            <div className="font-semibold">対応フォーマット</div>
            <div>・CSV(カンマ区切り)、TSV(タブ区切り)</div>
            <div>・「入金」「出金」「収入」「支出」列があれば自動判別</div>
            <div>・金額1列の場合は、下の「取り込むタイプ」で指定できます</div>
            <div>・プレビュー画面で各行の収入/支出、カテゴリ、金額を編集できます</div>
          </div>

          <div>
            <label className="text-xs text-stone-500 tracking-wider block mb-1">金額1列のCSVの扱い</label>
            <div className="grid grid-cols-3 gap-2">
              <SegButton active={defaultType === "auto"} onClick={() => setDefaultType("auto")}>
                自動判別
              </SegButton>
              <SegButton active={defaultType === "in"} onClick={() => setDefaultType("in")} tone="pos">
                <TrendingUp size={14} /> 全て収入
              </SegButton>
              <SegButton active={defaultType === "out"} onClick={() => setDefaultType("out")} tone="neg">
                <TrendingDown size={14} /> 全て支出
              </SegButton>
            </div>
          </div>

          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" onChange={handleFile} className="hidden" />
            <button onClick={() => fileRef.current?.click()} className="flex-1 px-3 py-2 border border-stone-400 bg-white text-stone-700 text-sm hover:bg-stone-50 flex items-center justify-center gap-1.5">
              <Upload size={14} /> ファイルを選択
            </button>
          </div>

          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={"例1:\n日付,項目,金額\n2026-04-25,家賃,-47000\n2026-05-01,売上,500000\n\n例2(入金/出金列が分かれる):\n日付,項目,入金,出金\n2026-05-01,売上,500000,\n2026-05-02,家賃,,47000"}
            className="w-full h-48 px-3 py-2 bg-white border border-stone-300 text-stone-800 text-sm font-mono focus:outline-none focus:border-stone-600"
          />

          <div className="flex gap-2">
            <Button onClick={handleParse}>プレビュー</Button>
            {preview.length > 0 && (
              <Button onClick={handleImport} full>
                <Check size={14} /> {preview.length}件を取り込む
              </Button>
            )}
          </div>

          {error && <div className="text-xs text-red-800 bg-red-50/70 border border-red-900/20 p-2">{error}</div>}
        </div>
      </Panel>

      {preview.length > 0 && (
        <Panel title={`プレビュー (${preview.length}件)`} subtitle="各行の内容はここで修正できます">
          <div className="flex gap-2 mb-3">
            <button onClick={() => setAllType("in")} className="text-xs px-3 py-1.5 border border-green-800 text-green-800 bg-white hover:bg-green-50 flex items-center gap-1">
              <TrendingUp size={12} /> 全て収入に
            </button>
            <button onClick={() => setAllType("out")} className="text-xs px-3 py-1.5 border border-red-800 text-red-800 bg-white hover:bg-red-50 flex items-center gap-1">
              <TrendingDown size={12} /> 全て支出に
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto space-y-1">
            {preview.map((e, i) => {
              const cats = CATEGORIES.filter((c) => c.type === e.type);
              const cat = CATEGORIES.find((c) => c.id === e.category);
              return (
                <div key={i} className="p-2 bg-stone-50/60 border border-stone-200 text-sm">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-1 self-stretch" style={{ background: cat?.color || "#999", minHeight: 24 }} />
                    <input
                      type="date"
                      value={e.date}
                      onChange={(ev) => updatePreviewRow(i, { date: ev.target.value })}
                      className="px-2 py-1 bg-white border border-stone-300 text-xs tabular-nums w-32"
                    />
                    <input
                      value={e.label}
                      onChange={(ev) => updatePreviewRow(i, { label: ev.target.value })}
                      className="flex-1 px-2 py-1 bg-white border border-stone-300 text-xs min-w-0"
                    />
                    <IconBtn onClick={() => deletePreviewRow(i)} danger>
                      <Trash2 size={12} />
                    </IconBtn>
                  </div>
                  <div className="flex items-center gap-2 pl-3">
                    <select
                      value={e.type}
                      onChange={(ev) => {
                        const newType = ev.target.value;
                        updatePreviewRow(i, { type: newType, category: detectCategory(e.label, newType) });
                      }}
                      className={`px-2 py-1 bg-white border text-xs ${e.type === "in" ? "border-green-700 text-green-800" : "border-red-700 text-red-800"}`}
                    >
                      <option value="in">収入</option>
                      <option value="out">支出</option>
                    </select>
                    <select
                      value={e.category}
                      onChange={(ev) => updatePreviewRow(i, { category: ev.target.value })}
                      className="px-2 py-1 bg-white border border-stone-300 text-xs"
                    >
                      {cats.map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      value={e.amount}
                      onChange={(ev) => updatePreviewRow(i, { amount: Number(ev.target.value) || 0 })}
                      className={`ml-auto px-2 py-1 bg-white border border-stone-300 text-xs tabular-nums w-28 text-right ${e.type === "in" ? "text-green-800" : "text-red-800"}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel title="freeeとのAPI連携について">
        <div className="text-sm text-stone-700 space-y-2">
          <p>
            リアルタイムでのfreee API連携には、OAuth認証とトークン管理のためのバックエンドサーバーが必要で、このブラウザ単独のアプリでは実装できません。
          </p>
          <p className="text-stone-600"><strong>現実的な代替案:</strong></p>
          <ul className="list-disc list-inside text-stone-600 space-y-1 pl-2">
            <li>freee管理画面 → 「取引」 → CSVエクスポート → 上のフォームに貼り付け</li>
            <li>本格的な自動同期が必要な場合は、Vercel/Cloudflare Workers等でAPIサーバーを別途構築</li>
          </ul>
        </div>
      </Panel>
    </div>
  );
}

function Panel({ title, subtitle, children }) {
  return (
    <section className="bg-white/60 backdrop-blur-sm border border-stone-300/80 p-4 sm:p-5">
      {title && (
        <div className="mb-4">
          <h2 className="text-base sm:text-lg font-bold text-stone-800 tracking-tight" style={{ fontFamily: "'Shippori Mincho', 'Noto Serif JP', serif" }}>
            {title}
          </h2>
          {subtitle && <p className="text-xs text-stone-500 mt-0.5">{subtitle}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

function StatCard({ label, value, tone }) {
  const toneClass = tone === "pos" ? "text-green-800" : tone === "neg" ? "text-red-800" : "text-stone-800";
  return (
    <div className="bg-white/60 border border-stone-300/80 p-3 sm:p-4">
      <div className="text-[10px] sm:text-xs text-stone-500 tracking-wider mb-1">{label}</div>
      <div className={`text-base sm:text-xl font-bold tabular-nums ${toneClass}`} style={{ fontFamily: "'Shippori Mincho', 'Noto Serif JP', serif" }}>
        {value}
      </div>
    </div>
  );
}

function Input({ value, onChange, placeholder, type = "text" }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2.5 bg-white border border-stone-300 text-stone-800 text-sm focus:outline-none focus:border-stone-600 transition-colors"
    />
  );
}

function Select({ value, onChange, children }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2.5 bg-white border border-stone-300 text-stone-800 text-sm focus:outline-none focus:border-stone-600 transition-colors"
    >
      {children}
    </select>
  );
}

function Button({ children, onClick, full }) {
  return (
    <button
      onClick={onClick}
      className={`${full ? "w-full" : ""} inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-stone-800 text-stone-50 text-sm font-medium hover:bg-stone-900 transition-colors`}
    >
      {children}
    </button>
  );
}

function IconBtn({ children, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`p-2 shrink-0 transition-colors ${danger ? "text-stone-400 hover:text-red-700" : "text-stone-400 hover:text-stone-700"}`}
    >
      {children}
    </button>
  );
}

function SegButton({ children, active, onClick, tone }) {
  const activeClass = tone === "pos" ? "bg-green-800 text-white border-green-800" : tone === "neg" ? "bg-red-800 text-white border-red-800" : "bg-stone-800 text-white border-stone-800";
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 px-3 py-2.5 border text-sm transition-colors ${active ? activeClass : "bg-white border-stone-300 text-stone-600 hover:border-stone-500"}`}
    >
      {children}
    </button>
  );
}

function Empty({ children }) {
  return <div className="text-center py-8 text-sm text-stone-400">{children}</div>;
}
