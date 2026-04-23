"use client";

import { useEffect, useState } from "react";

const themes = [
  {
    name: "night",
    hours: [23, 0, 1, 2, 3, 4, 5],
    bg: "/bg/night.jpg",
    vars: {
      "--tt-nav-bg": "rgba(15,15,35,0.65)",
      "--tt-nav-text": "#8898b8",
      "--tt-nav-active": "rgba(70,90,160,0.3)",
      "--tt-nav-active-text": "#a0b0d0",
      "--tt-header-text": "#7888a8",
      "--tt-view-btn": "rgba(70,90,160,0.25)",
      "--tt-view-btn-text": "#98a8c8",
      "--tt-grid-bg": "rgba(10,10,25,0.35)",
      "--tt-grid-header": "#6878a0",
      "--tt-grid-border": "rgba(70,80,130,0.12)",
      "--tt-time-text": "rgba(100,120,170,0.6)",
      "--tt-overlay": "linear-gradient(180deg, rgba(15,15,30,0.82) 0%, rgba(20,20,40,0.7) 50%, rgba(10,10,25,0.78) 100%)",
      "--tt-surface": "rgba(20,20,45,0.6)",
      "--tt-surface-border": "rgba(70,80,130,0.2)",
      "--tt-sidebar-bg": "rgba(12,12,30,0.85)",
      "--tt-event-primary": "rgba(60,80,160,0.45)",
      "--tt-event-primary-border": "#3c50a0",
      "--tt-event-primary-text": "#c0d0f0",
      "--tt-calendar-text": "#8898b8",
      "--tt-today-bg": "rgba(70,90,160,0.1)",
    },
  },
  {
    name: "morning",
    hours: [6, 7, 8, 9],
    bg: "/bg/morning.jpg",
    vars: {
      "--tt-nav-bg": "rgba(80,60,20,0.6)",
      "--tt-nav-text": "#f0dbb8",
      "--tt-nav-active": "rgba(210,170,80,0.3)",
      "--tt-nav-active-text": "#ffe8b0",
      "--tt-header-text": "#e8d4a8",
      "--tt-view-btn": "rgba(210,170,80,0.25)",
      "--tt-view-btn-text": "#ffe0a0",
      "--tt-grid-bg": "rgba(60,45,15,0.3)",
      "--tt-grid-header": "#e0c890",
      "--tt-grid-border": "rgba(200,170,100,0.12)",
      "--tt-time-text": "rgba(220,190,130,0.6)",
      "--tt-overlay": "linear-gradient(135deg, rgba(62,48,20,0.78) 0%, rgba(90,70,30,0.6) 50%, rgba(120,100,40,0.5) 100%)",
      "--tt-surface": "rgba(70,50,20,0.55)",
      "--tt-surface-border": "rgba(200,170,100,0.2)",
      "--tt-sidebar-bg": "rgba(50,38,15,0.85)",
      "--tt-event-primary": "rgba(210,170,80,0.45)",
      "--tt-event-primary-border": "#d4a840",
      "--tt-event-primary-text": "#fff5e0",
      "--tt-calendar-text": "#f0dbb8",
      "--tt-today-bg": "rgba(210,170,80,0.1)",
    },
  },
  {
    name: "midday",
    hours: [10, 11, 12, 13],
    bg: "/bg/midday.jpg",
    vars: {
      "--tt-nav-bg": "rgba(220,235,250,0.7)",
      "--tt-nav-text": "#2a4a6a",
      "--tt-nav-active": "rgba(60,130,200,0.2)",
      "--tt-nav-active-text": "#1a4a7a",
      "--tt-header-text": "#2a4a6a",
      "--tt-view-btn": "rgba(60,130,200,0.15)",
      "--tt-view-btn-text": "#1a4a7a",
      "--tt-grid-bg": "rgba(230,240,250,0.4)",
      "--tt-grid-header": "#2a5070",
      "--tt-grid-border": "rgba(100,150,200,0.15)",
      "--tt-time-text": "rgba(40,80,120,0.55)",
      "--tt-overlay": "linear-gradient(180deg, rgba(180,210,230,0.55) 0%, rgba(140,180,210,0.45) 50%, rgba(200,220,240,0.55) 100%)",
      "--tt-surface": "rgba(220,235,250,0.55)",
      "--tt-surface-border": "rgba(120,160,200,0.25)",
      "--tt-sidebar-bg": "rgba(210,228,245,0.88)",
      "--tt-event-primary": "rgba(60,140,220,0.35)",
      "--tt-event-primary-border": "#3c8cdc",
      "--tt-event-primary-text": "#1a3a5a",
      "--tt-calendar-text": "#2a4a6a",
      "--tt-today-bg": "rgba(60,130,200,0.08)",
    },
  },
  {
    name: "afternoon",
    hours: [14, 15, 16],
    bg: "/bg/afternoon.jpg",
    vars: {
      "--tt-nav-bg": "rgba(15,50,70,0.6)",
      "--tt-nav-text": "#b0d8e8",
      "--tt-nav-active": "rgba(80,170,200,0.25)",
      "--tt-nav-active-text": "#c0e0f0",
      "--tt-header-text": "#90c8d8",
      "--tt-view-btn": "rgba(80,170,200,0.2)",
      "--tt-view-btn-text": "#b0dae8",
      "--tt-grid-bg": "rgba(15,45,60,0.35)",
      "--tt-grid-header": "#80c0d0",
      "--tt-grid-border": "rgba(100,180,210,0.1)",
      "--tt-time-text": "rgba(140,200,220,0.55)",
      "--tt-overlay": "linear-gradient(180deg, rgba(20,60,80,0.7) 0%, rgba(30,70,90,0.55) 50%, rgba(20,50,70,0.65) 100%)",
      "--tt-surface": "rgba(20,55,75,0.55)",
      "--tt-surface-border": "rgba(100,180,210,0.18)",
      "--tt-sidebar-bg": "rgba(15,45,65,0.88)",
      "--tt-event-primary": "rgba(60,160,190,0.4)",
      "--tt-event-primary-border": "#3ca0be",
      "--tt-event-primary-text": "#d0f0ff",
      "--tt-calendar-text": "#b0d8e8",
      "--tt-today-bg": "rgba(80,170,200,0.08)",
    },
  },
  {
    name: "golden",
    hours: [17, 18, 19],
    bg: "/bg/golden.jpg",
    vars: {
      "--tt-nav-bg": "rgba(70,45,20,0.6)",
      "--tt-nav-text": "#e8c898",
      "--tt-nav-active": "rgba(220,160,60,0.3)",
      "--tt-nav-active-text": "#ffe0a0",
      "--tt-header-text": "#dcc090",
      "--tt-view-btn": "rgba(220,160,60,0.25)",
      "--tt-view-btn-text": "#ffd890",
      "--tt-grid-bg": "rgba(50,35,15,0.35)",
      "--tt-grid-header": "#d4b480",
      "--tt-grid-border": "rgba(200,150,80,0.12)",
      "--tt-time-text": "rgba(200,160,100,0.55)",
      "--tt-overlay": "linear-gradient(135deg, rgba(60,40,20,0.75) 0%, rgba(80,50,25,0.55) 50%, rgba(50,35,20,0.65) 100%)",
      "--tt-surface": "rgba(60,40,18,0.55)",
      "--tt-surface-border": "rgba(200,150,80,0.2)",
      "--tt-sidebar-bg": "rgba(50,35,15,0.88)",
      "--tt-event-primary": "rgba(220,150,50,0.4)",
      "--tt-event-primary-border": "#dc9632",
      "--tt-event-primary-text": "#fff0d0",
      "--tt-calendar-text": "#e8c898",
      "--tt-today-bg": "rgba(220,160,60,0.08)",
    },
  },
  {
    name: "evening",
    hours: [20, 21, 22],
    bg: "/bg/evening.jpg",
    vars: {
      "--tt-nav-bg": "rgba(45,20,30,0.65)",
      "--tt-nav-text": "#c8a0b0",
      "--tt-nav-active": "rgba(200,120,100,0.3)",
      "--tt-nav-active-text": "#f0c0b0",
      "--tt-header-text": "#c090a0",
      "--tt-view-btn": "rgba(200,120,100,0.25)",
      "--tt-view-btn-text": "#e8b0a0",
      "--tt-grid-bg": "rgba(35,15,25,0.35)",
      "--tt-grid-header": "#b08090",
      "--tt-grid-border": "rgba(160,100,120,0.12)",
      "--tt-time-text": "rgba(180,120,140,0.55)",
      "--tt-overlay": "linear-gradient(180deg, rgba(40,20,30,0.78) 0%, rgba(50,25,35,0.65) 50%, rgba(30,15,25,0.72) 100%)",
      "--tt-surface": "rgba(40,18,28,0.55)",
      "--tt-surface-border": "rgba(160,100,120,0.2)",
      "--tt-sidebar-bg": "rgba(35,15,25,0.88)",
      "--tt-event-primary": "rgba(200,100,80,0.4)",
      "--tt-event-primary-border": "#c86450",
      "--tt-event-primary-text": "#ffd8c8",
      "--tt-calendar-text": "#c8a0b0",
      "--tt-today-bg": "rgba(200,120,100,0.08)",
    },
  },
];

function getThemeForHour(hour: number) {
  return themes.find((t) => t.hours.includes(hour)) || themes[0];
}

export function TimeThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState(() => getThemeForHour(new Date().getHours()));

  useEffect(() => {
    const update = () => setTheme(getThemeForHour(new Date().getHours()));
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    Object.entries(theme.vars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    root.setAttribute("data-time-theme", theme.name);
  }, [theme]);

  return (
    <>
      {/* Background image layer */}
      <div
        className="fixed inset-0 -z-20 bg-cover bg-center bg-no-repeat transition-opacity duration-[3000ms]"
        style={{ backgroundImage: `url(${theme.bg})` }}
      />
      {/* Overlay layer */}
      <div
        className="fixed inset-0 -z-10 transition-all duration-[3000ms]"
        style={{ background: theme.vars["--tt-overlay"] }}
      />
      {children}
    </>
  );
}
