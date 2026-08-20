import React, { useEffect, useState } from "react";
import { MapPin, ShieldCheck } from "lucide-react";
import api from "@/services/api";
import { Button } from "@/components/ui/button";

export default function GuideTrackerPage() {
  const [state, setState] = useState("ready");
  const [message, setMessage] = useState("Tap start to share your live location with the assigned traveller.");
  const params = new URLSearchParams(window.location.search);
  const guideId = String(window.location.pathname.split("/").pop() || "");
  const token = params.get("token") || "";

  useEffect(() => {
    if (!guideId || !token || !navigator.geolocation) {
      setState("error");
      setMessage("This tracking link is invalid or this device does not support GPS.");
    }
  }, [guideId, token]);

  const start = () => {
    if (!navigator.geolocation) return;
    setState("sharing");
    setMessage("Requesting GPS permission...");
    navigator.geolocation.watchPosition(async (position) => {
      try {
        await api.post(`/tourism/guides/${guideId}/location`, {
          token,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy_m: position.coords.accuracy,
        });
        setMessage(`Location shared at ${new Date().toLocaleTimeString()}. Keep this page open while travelling.`);
      } catch (error) {
        setState("error");
        setMessage(error?.response?.data?.detail || "Location update failed.");
      }
    }, () => {
      setState("error");
      setMessage("GPS permission is required to share the guide location.");
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  };

  return <main className="min-h-screen bg-slate-50 px-5 py-12 text-slate-700"><section className="mx-auto max-w-md rounded-2xl border border-sky-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-lg bg-sky-100 p-2 text-sky-800"><MapPin className="h-6 w-6" /></div><div><p className="text-xs font-semibold uppercase tracking-widest text-sky-800">METHO Travel</p><h1 className="font-display text-2xl font-black text-emerald-950">Guide live tracking</h1></div></div><div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm"><p className="flex items-center gap-2 font-semibold text-emerald-900"><ShieldCheck className="h-4 w-4" /> Secure trip link</p><p className="mt-1 text-xs text-emerald-800">Only the assigned traveller and METHO operations can use this location.</p></div><p className="mt-5 text-sm text-slate-600">{message}</p>{state !== "sharing" && state !== "error" ? <Button onClick={start} className="mt-5 w-full rounded-full bg-emerald-900 hover:bg-emerald-950">Start sharing GPS</Button> : null}{state === "error" ? <Button onClick={start} className="mt-5 w-full rounded-full bg-sky-700 hover:bg-sky-800">Try again</Button> : null}</section></main>;
}
