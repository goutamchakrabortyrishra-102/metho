import React, { useEffect, useState } from "react";
import { CheckCircle2, LogOut, Power, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/services/api";

export default function RiderDashboardPage() {
  const { user, logout } = useAuth();
  const [rider, setRider] = useState(null);
  const [availability, setAvailability] = useState("offline");
  const [jobs, setJobs] = useState([]);
  const nav = useNavigate();

  useEffect(() => {
    api.get("/rider/me").then(({ data }) => {
      setRider(data.rider);
      setAvailability(data.rider?.availability || "offline");
    }).catch((error) => toast.error(error?.response?.data?.detail || "Could not load rider profile"));
    loadJobs();
  }, []);

  const loadJobs = async () => {
    try { const { data } = await api.get("/rider/metho-move/bookings"); setJobs(data.bookings || []); } catch (error) { toast.error(error?.response?.data?.detail || "Could not load assigned jobs"); }
  };

  const toggleAvailability = async () => {
    const next = availability === "online" ? "offline" : "online";
    try {
      const position = await new Promise((resolve) => navigator.geolocation?.getCurrentPosition((value) => resolve(value.coords), () => resolve(null)) || resolve(null));
      await api.put("/rider/availability", { availability: next, latitude: position?.latitude, longitude: position?.longitude });
      setAvailability(next);
      toast.success(`You are now ${next}`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update availability");
    }
  };

  const signOut = () => { logout(); nav("/"); };

  return (
    <main className="min-h-screen bg-secondary/30 p-6 md:p-10" data-testid="rider-dashboard">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between gap-4 mb-8">
          <div><p className="text-sm text-emerald-800">METHO Rider</p><h1 className="font-display font-black text-3xl text-emerald-950">Welcome, {user?.name || rider?.name}</h1></div>
          <Button variant="outline" onClick={signOut}><LogOut className="mr-2 h-4 w-4" /> Sign out</Button>
        </div>
        <section className="rounded-xl bg-white p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between gap-4"><h2 className="font-display text-xl font-bold text-emerald-950">Availability</h2><span className="capitalize text-sm text-muted-foreground">{availability}</span></div>
          <Button onClick={toggleAvailability} className="rounded-full bg-emerald-900 hover:bg-emerald-950"><Power className="mr-2 h-4 w-4" /> Go {availability === "online" ? "offline" : "online"}</Button>
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <p><strong>Vehicle:</strong> {rider?.vehicle_type || "-"}</p>
            <p><strong>Number:</strong> {rider?.vehicle_number || "-"}</p>
            <p><strong>Phone:</strong> {rider?.phone || "-"}</p>
            <p><strong>Status:</strong> {rider?.approval_status || "approved"}</p>
          </div>
        </section>
        <section className="mt-6 rounded-xl bg-white p-6 shadow-sm"><div className="flex items-center justify-between gap-3"><h2 className="font-display text-xl font-bold text-emerald-950">Assigned METHO Move jobs</h2><Button variant="outline" size="sm" onClick={loadJobs}><RefreshCw className="mr-2 h-4 w-4" /> Refresh</Button></div><div className="mt-4 grid gap-3">{jobs.length ? jobs.map((job) => <div key={job.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold text-emerald-950">{job.service_type} · {job.status}</p><p className="text-sm text-slate-600">{job.pickup} → {job.destination}</p><p className="text-xs text-slate-500">{job.customer_name} · {job.customer_phone}</p></div><div className="flex gap-2">{job.status === "assigned" ? <Button size="sm" onClick={async () => { await api.post(`/rider/metho-move/bookings/${job.id}/accept`); loadJobs(); }}><CheckCircle2 className="mr-1 h-4 w-4" /> Accept</Button> : null}{["accepted", "assigned"].includes(job.status) ? <Button size="sm" variant="outline" onClick={async () => { await api.post(`/rider/metho-move/bookings/${job.id}/complete`, {}); loadJobs(); }}>Complete</Button> : null}</div></div></div>) : <p className="text-sm text-slate-500">No assigned jobs.</p>}</div></section>
      </div>
    </main>
  );
}