"use client";

import { useEffect, useRef, useState } from "react";
import { ToolButton } from "./ui";

interface SpeechRecognitionEventLike {
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
  resultIndex: number;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function recognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export function DictationButton({
  onTranscript,
  label,
}: {
  onTranscript: (text: string) => void;
  label: string;
}) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const supported = recognitionConstructor() !== null;

  useEffect(() => () => recognitionRef.current?.abort(), []);

  const toggle = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Recognition = recognitionConstructor();
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = document.documentElement.lang || navigator.language || "en-US";
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) transcript += `${event.results[index][0].transcript} `;
      }
      if (transcript.trim()) onTranscript(transcript.trim());
    };
    recognition.onerror = () => {
      setError("Dictation stopped. Check microphone permission and try again.");
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setError("");
    setListening(true);
    recognition.start();
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={!supported}
        aria-pressed={listening}
        aria-label={listening ? `Stop dictating ${label}` : `Dictate ${label}`}
        title={supported ? "Push to dictate; push again to stop" : "Dictation is unavailable in this browser"}
        className={`rounded-md border px-2.5 py-1 text-[11px] transition ${
          listening
            ? "border-bad/60 bg-bad/15 text-bad"
            : "border-ink-700 bg-ink-800 text-ink-200 hover:border-brass-400/60 hover:text-brass-300"
        } disabled:cursor-not-allowed disabled:opacity-40`}
      >
        {listening ? "■ Stop" : "🎙 Dictate"}
      </button>
      {error && <span role="alert" className="max-w-56 text-right text-[10px] text-bad">{error}</span>}
    </span>
  );
}

export function ReadAloudControls({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState(1);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const start = () => {
    if (!supported || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.onend = () => {
      setSpeaking(false);
      setPaused(false);
    };
    utterance.onerror = () => {
      setSpeaking(false);
      setPaused(false);
    };
    setSpeaking(true);
    setPaused(false);
    window.speechSynthesis.speak(utterance);
  };

  const pauseOrResume = () => {
    if (paused) window.speechSynthesis.resume();
    else window.speechSynthesis.pause();
    setPaused(!paused);
  };

  const stop = () => {
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setPaused(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Read document aloud controls">
      <ToolButton onClick={speaking ? pauseOrResume : start}>
        {speaking ? (paused ? "▶ Resume" : "⏸ Pause") : "🔊 Read aloud"}
      </ToolButton>
      {speaking && <ToolButton onClick={stop}>■ Stop</ToolButton>}
      <label className="flex items-center gap-1 text-[10px] text-ink-400">
        Speed
        <select
          value={rate}
          onChange={(event) => setRate(Number(event.target.value))}
          aria-label="Read aloud speed"
          className="rounded border border-ink-700 bg-ink-950 px-1.5 py-1 text-[10px] text-ink-100"
        >
          <option value="0.75">0.75×</option>
          <option value="1">1×</option>
          <option value="1.25">1.25×</option>
          <option value="1.5">1.5×</option>
          <option value="2">2×</option>
        </select>
      </label>
    </div>
  );
}

