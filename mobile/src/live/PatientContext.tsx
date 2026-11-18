import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from './native';
export type Profile = {
  id: string;
  name: string;
  relationship?: string;
  date_of_birth?: string | null;
  sex?: string;
};
export type Clinic = {
  id: string;
  name: string;
  description?: string;
  address?: string;
  city?: string;
  phone?: string;
  pay_at_clinic?: boolean;
  manual_check_in?: boolean;
  branches?: { id: string; name: string }[];
};
export type Doctor = {
  id: string;
  clinic_id: string;
  branch_ids: string[];
  name: string;
  specialty: string;
  qualification?: string;
  about?: string;
  consultation_fee: number;
  rating?: number | null;
};
export type Appointment = {
  id: string;
  appointment_number: string;
  appointment_date: string;
  appointment_time: string;
  status: string;
  doctor_name?: string;
  clinic_name?: string;
  patient_name?: string;
  branch_name?: string;
  branch_id?: string;
  clinic_id?: string;
  doctor_id?: string;
  updated_at?: string;
  token_number?: string;
  queue_serial?: number;
  reason?: string;
  total?: number;
  payment_status?: string;
};
export type Quote = {
  id: string;
  total_cents: number;
  currency: string;
  expires_at: string;
  payment_options: { pay_at_clinic: boolean; online: boolean };
};
export type Me = { profile: Profile; phone: string; self_profile_id: string };
function usePatientState() {
  const [ready, setReady] = useState(false),
    [signedIn, setSignedIn] = useState(false),
    [me, setMe] = useState<Me | null>(null),
    [profile, setProfile] = useState<Profile | null>(null);
  const [clinic, setClinic] = useState<Clinic | null>(null),
    [doctor, setDoctor] = useState<Doctor | null>(null),
    [branch, setBranch] = useState(''),
    [appointment, setAppointment] = useState<Appointment | null>(null),
    [hold, setHold] = useState<{ id: string; expires_at: string } | null>(null),
    [quote, setQuote] = useState<Quote | null>(null),
    [challenge, setChallenge] = useState<{
      challenge_id: string;
      resend_after: number;
      phone: string;
    } | null>(null),
    [phone, setPhone] = useState(''),
    [record, setRecord] = useState<{
      id: string;
      kind?: string;
      title?: string;
      [key: string]: unknown;
    } | null>(null);
  const reset = () => {
    setSignedIn(false);
    setMe(null);
    setProfile(null);
    setAppointment(null);
    setHold(null);
    setQuote(null);
    setRecord(null);
  };
  async function loadMe() {
    const value = await api.request<Me>('/me');
    setMe(value);
    setProfile(value.profile);
    setSignedIn(true);
    return value;
  }
  useEffect(() => {
    let alive = true;
    api.onExpired = reset;
    api
      .restore()
      .then(async restored => {
        if (restored && alive) await loadMe();
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
      api.onExpired = () => {};
    };
  }, []);
  async function logout() {
    try {
      await api.request('/auth/logout', 'POST');
    } finally {
      await api.clear();
      reset();
    }
  }
  function selectDoctor(value: Doctor) {
    setDoctor(value);
    setBranch(value.branch_ids[0] ?? '');
    setQuote(null);
  }
  return {
    ready,
    signedIn,
    me,
    profile,
    setProfile,
    loadMe,
    logout,
    clinic,
    setClinic,
    doctor,
    selectDoctor,
    branch,
    setBranch,
    appointment,
    setAppointment,
    hold,
    setHold,
    quote,
    setQuote,
    challenge,
    setChallenge,
    phone,
    setPhone,
    record,
    setRecord,
  };
}
const Context = createContext<ReturnType<typeof usePatientState> | null>(null);
export function PatientProvider({ children }: React.PropsWithChildren) {
  return (
    <Context.Provider value={usePatientState()}>{children}</Context.Provider>
  );
}
export function usePatient() {
  const value = useContext(Context);
  if (!value) throw Error('Patient provider is missing.');
  return value;
}
