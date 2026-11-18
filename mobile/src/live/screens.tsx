import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Razorpay from 'react-native-razorpay';
import QRCode from 'react-native-qrcode-svg';
import { Button, Field, Screen } from '../components/ui';
import { Brand, Avatar } from '../components/Illustrations';
import { colors, s } from '../theme';
import type { Navigation, ScreenName } from '../navigation';
import { api, chooseFile, downloadDocument } from './native';
import type { Tokens } from './client';
import {
  usePatient,
  type Appointment,
  type Clinic,
  type Doctor,
  type Profile,
  type Quote,
} from './PatientContext';

type Item = {
  id: string;
  name?: string;
  title?: string;
  kind?: string;
  status?: string;
  record_date?: string;
  download_path?: string;
  [key: string]: unknown;
};
const asText = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const query = (values: Record<string, string | undefined>) =>
  '?' +
  Object.entries(values)
    .filter(([, value]) => value)
    .map(
      ([key, value]) =>
        `${key}=${encodeURIComponent(value!).replace(/'/g, '%27')}`,
    )
    .join('&');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(d.getDate()).padStart(2, '0')}`;
};
function uuid() {
  const bytes = new Uint8Array(16);
  (
    globalThis as unknown as {
      crypto: { getRandomValues: (value: Uint8Array) => Uint8Array };
    }
  ).crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  return Array.from(
    bytes,
    (b, i) =>
      ([4, 6, 8, 10].includes(i) ? '-' : '') + b.toString(16).padStart(2, '0'),
  ).join('');
}
function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    running = useRef(false);
  return {
    busy,
    error,
    run: async (work: () => Promise<void>) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setError('');
      try {
        await work();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Request failed. Please try again.',
        );
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
  };
}
function useResource<T>(path: string | null, poll = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let live = true,
        pending = false;
      const load = async () => {
        if (!path || pending || AppState.currentState === 'background') return;
        pending = true;
        setBusy(true);
        try {
          const result = await api.request<T>(path, 'GET', undefined, {
            public: !isPrivatePath(path),
          });
          if (live) {
            setData(result);
            setError('');
          }
        } catch (e) {
          if (live)
            setError(e instanceof Error ? e.message : 'Unable to load.');
        } finally {
          pending = false;
          if (live) setBusy(false);
        }
      };
      setData(null);
      void load();
      const timer = poll ? setInterval(() => void load(), poll) : null;
      const listener = AppState.addEventListener('change', state => {
        if (state === 'active') void load();
      });
      return () => {
        live = false;
        if (timer) clearInterval(timer);
        listener.remove();
      };
    }, [path, poll, revision]),
  );
  return { data, error, busy, reload: () => setRevision(n => n + 1) };
}
function isPrivatePath(path: string) {
  return !/^\/(config|clinics|doctors|specialties)(\/|\?|$)/.test(path);
}
function Notice({ text }: { text?: string }) {
  return text ? (
    <Text accessibilityRole="alert" style={styles.error}>
      {text}
    </Text>
  ) : null;
}
function Tile({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={styles.card}
    >
      <Text style={styles.cardTitle}>{title}</Text>
      {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
    </Pressable>
  );
}
function DataState({
  resource,
}: {
  resource: { busy: boolean; error: string; reload: () => void };
}) {
  return (
    <>
      {resource.busy && <ActivityIndicator color={colors.blue} />}
      <Notice text={resource.error} />
      {resource.error && (
        <Button secondary title="Retry" onPress={resource.reload} />
      )}
    </>
  );
}
function list<T>(data: { data: T[] } | T[] | null): T[] {
  return Array.isArray(data) ? data : data?.data ?? [];
}
function Details({ value }: { value: Record<string, unknown> }) {
  const allowed = [
    'title',
    'name',
    'date',
    'record_date',
    'status',
    'patient_name',
    'doctor_name',
    'clinic_name',
    'branch_name',
    'appointment_number',
    'appointment_date',
    'appointment_time',
    'token_number',
    'queue_serial',
    'payment_status',
    'total',
    'reason',
    'symptoms',
    'history',
    'vitals',
    'investigation',
    'diagnosis',
    'advice',
    'follow_up',
    'comment',
    'medicines',
    'lab_tests',
    'notes',
    'summary',
    'message',
    'body',
  ];
  return (
    <View style={styles.card}>
      {allowed
        .filter(
          key =>
            value[key] !== undefined &&
            value[key] !== null &&
            value[key] !== '',
        )
        .map(key => (
          <View key={key} style={{ marginBottom: 12 }}>
            <Text style={styles.label}>{key.replace(/_/g, ' ')}</Text>
            <Text style={s.text}>{format(value[key])}</Text>
          </View>
        ))}
    </View>
  );
}
function format(value: unknown): string {
  if (Array.isArray(value)) return value.map(format).join('\n');
  if (value && typeof value === 'object')
    return Object.entries(value)
      .filter(([key]) => !key.endsWith('_id'))
      .map(([key, v]) => `${key.replace(/_/g, ' ')}: ${format(v)}`)
      .join(' · ');
  return asText(value);
}
const links: [ScreenName, string][] = [
  ['Home', 'Home'],
  ['Clinics', 'Find a clinic'],
  ['Doctors', 'Find a doctor'],
  ['Appointments', 'My appointments'],
  ['Records', 'Medical records'],
  ['LabReports', 'Lab tests & reports'],
  ['Invoices', 'Payments & invoices'],
  ['Notifications', 'Notifications'],
  ['Family', 'Family members'],
  ['Account', 'Account & help'],
];
function Menu() {
  const nav = useNavigation<Navigation>();
  return (
    <View style={styles.menu}>
      {links.map(([name, title]) => (
        <Pressable
          key={name}
          onPress={() => nav.navigate(name)}
          style={styles.pill}
        >
          <Text style={s.blue}>{title}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Welcome() {
  const nav = useNavigation<Navigation>(),
    p = usePatient(),
    a = useAction(),
    config = useResource<{ sms_login_configured: boolean }>('/config');
  return (
    <Screen title="Welcome to JibonCare" light>
      <View style={{ alignItems: 'center', paddingVertical: 24 }}>
        <Brand />
        <Avatar doctor size={130} />
        <Text style={s.title}>Your clinic, connected.</Text>
        <Text style={styles.muted}>
          Book visits, follow your queue and access your own health records.
        </Text>
      </View>
      <DataState resource={config} />
      <Notice text={a.error} />
      <Field
        label="Mobile number"
        keyboardType="phone-pad"
        maxLength={10}
        value={p.phone}
        onChangeText={p.setPhone}
      />
      {config.data && !config.data.sms_login_configured && (
        <Text style={styles.muted}>
          Phone sign-in will be available after the clinic configures SMS. You
          can browse clinics and doctors now.
        </Text>
      )}
      <Button
        title={a.busy ? 'Sending…' : 'Send OTP'}
        disabled={
          a.busy ||
          !/^\d{10}$/.test(p.phone) ||
          !config.data?.sms_login_configured
        }
        onPress={() =>
          void a.run(async () => {
            const challenge = await api.request<{
              challenge_id: string;
              resend_after: number;
              phone: string;
            }>(
              '/auth/otp/request',
              'POST',
              { phone: '+91' + p.phone },
              { public: true },
            );
            p.setChallenge(challenge);
            nav.navigate('OTP');
          })
        }
      />
      <Button
        secondary
        title="Browse clinics without signing in"
        onPress={() => nav.navigate('Clinics')}
      />
      {p.signedIn && (
        <Button title="Open my account" onPress={() => nav.navigate('Home')} />
      )}
    </Screen>
  );
}
function OTP() {
  const nav = useNavigation<Navigation>(),
    p = usePatient(),
    a = useAction(),
    [code, setCode] = useState(''),
    [seconds, setSeconds] = useState(p.challenge?.resend_after ?? 60);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds(n => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  return (
    <Screen title="Verify your phone" light>
      <Text style={s.title}>Enter your SMS code</Text>
      <Text style={styles.muted}>Sent to +91 {p.phone}</Text>
      <Field
        label="Six-digit OTP"
        keyboardType="number-pad"
        maxLength={6}
        value={code}
        onChangeText={setCode}
      />
      <Notice text={a.error} />
      <Button
        title={a.busy ? 'Verifying…' : 'Verify & sign in'}
        disabled={a.busy || !/^\d{6}$/.test(code) || !p.challenge}
        onPress={() =>
          void a.run(async () => {
            const response = await api.request<Tokens>(
              '/auth/otp/verify',
              'POST',
              { challenge_id: p.challenge!.challenge_id, code },
              { public: true },
            );
            await api.save(response);
            const me = await p.loadMe();
            nav.reset({
              index: 0,
              routes: [{ name: me.profile.name ? 'Home' : 'Profile' }],
            });
          })
        }
      />
      <Button
        secondary
        title={seconds ? `Resend in ${seconds}s` : 'Resend OTP'}
        disabled={seconds > 0 || a.busy}
        onPress={() =>
          void a.run(async () => {
            const next = await api.request<{
              challenge_id: string;
              resend_after: number;
              phone: string;
            }>(
              '/auth/otp/request',
              'POST',
              { phone: '+91' + p.phone },
              { public: true },
            );
            p.setChallenge(next);
            setSeconds(next.resend_after);
            setCode('');
          })
        }
      />
    </Screen>
  );
}
function ProfileScreen() {
  const p = usePatient(),
    nav = useNavigation<Navigation>(),
    a = useAction(),
    [name, setName] = useState(p.me?.profile.name ?? ''),
    [dob, setDob] = useState(p.me?.profile.date_of_birth ?? ''),
    [sex, setSex] = useState(p.me?.profile.sex ?? 'Other');
  return (
    <Screen title="My profile" light>
      <Field label="Full name" value={name} onChangeText={setName} />
      <Field
        label="Date of birth (YYYY-MM-DD)"
        value={dob}
        onChangeText={setDob}
      />
      <View style={styles.menu}>
        {['Male', 'Female', 'Other'].map(value => (
          <Button
            key={value}
            secondary={sex !== value}
            title={value}
            onPress={() => setSex(value)}
          />
        ))}
      </View>
      <Notice text={a.error} />
      <Button
        title="Save profile"
        disabled={a.busy || !name.trim()}
        onPress={() =>
          void a.run(async () => {
            await api.request('/me', 'PATCH', {
              name: name.trim(),
              date_of_birth: dob || null,
              sex,
            });
            await p.loadMe();
            nav.navigate('Home');
          })
        }
      />
    </Screen>
  );
}
function Family() {
  const p = usePatient(),
    a = useAction(),
    r = useResource<{ data: Profile[] }>('/family-members'),
    [name, setName] = useState(''),
    [dob, setDob] = useState(''),
    [relation, setRelation] = useState('Child'),
    [consent, setConsent] = useState(false);
  return (
    <Screen title="Family members" light>
      <DataState resource={r} />
      <Notice text={a.error} />
      {list(r.data).map(row => (
        <View key={row.id}>
          <Tile
            title={row.name || 'Complete your profile'}
            subtitle={`${row.relationship ?? 'Self'}${
              p.profile?.id === row.id ? ' · Selected' : ''
            }`}
            onPress={() => p.setProfile(row)}
          />
          {row.id !== p.me?.self_profile_id && (
            <Button
              secondary
              title={`Remove ${row.name}`}
              onPress={() =>
                Alert.alert(
                  'Remove family access?',
                  "This removes your app's access; clinic medical records are retained.",
                  [
                    { text: 'Keep' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () =>
                        void a.run(async () => {
                          await api.request(
                            '/family-members/' + row.id,
                            'DELETE',
                          );
                          p.setProfile(p.me?.profile ?? null);
                          r.reload();
                        }),
                    },
                  ],
                )
              }
            />
          )}
        </View>
      ))}
      <Text style={s.title}>Add a family member</Text>
      <Field label="Full name" value={name} onChangeText={setName} />
      <Field
        label="Date of birth (YYYY-MM-DD)"
        value={dob}
        onChangeText={setDob}
      />
      <View style={styles.menu}>
        {['Spouse', 'Child', 'Parent', 'Sibling', 'Other'].map(v => (
          <Button
            key={v}
            title={v}
            secondary={relation !== v}
            onPress={() => setRelation(v)}
          />
        ))}
      </View>
      <Button
        secondary
        title={
          consent
            ? 'Consent confirmed'
            : 'I have consent to manage this person’s care'
        }
        onPress={() => setConsent(!consent)}
      />
      <Button
        title="Add family member"
        disabled={a.busy || !consent || !name.trim()}
        onPress={() =>
          void a.run(async () => {
            await api.request('/family-members', 'POST', {
              name: name.trim(),
              date_of_birth: dob || null,
              relationship: relation,
              consent: true,
            });
            setName('');
            setDob('');
            setConsent(false);
            r.reload();
          })
        }
      />
    </Screen>
  );
}
function Home() {
  const p = usePatient(),
    nav = useNavigation<Navigation>(),
    r = useResource<{
      upcoming_appointments: Appointment[];
      unread_notifications: number;
    }>('/home' + query({ patient_id: p.profile?.id }));
  return (
    <Screen title="My health" tab="Home" light>
      <Text style={s.title}>Hello, {p.profile?.name || 'welcome'}</Text>
      <DataState resource={r} />
      <Menu />
      {r.data?.upcoming_appointments.map(row => (
        <Tile
          key={row.id}
          title={row.doctor_name ?? 'Appointment'}
          subtitle={`${row.appointment_date} ${row.appointment_time} · ${row.status}`}
          onPress={() => {
            p.setAppointment(row);
            nav.navigate('AppointmentDetails');
          }}
        />
      ))}
      {r.data && !r.data.upcoming_appointments.length && (
        <Text style={styles.muted}>
          No upcoming appointments. Find a clinic to book your first visit.
        </Text>
      )}
    </Screen>
  );
}
function Clinics() {
  const p = usePatient(),
    nav = useNavigation<Navigation>(),
    [search, setSearch] = useState(''),
    [term, setTerm] = useState(''),
    r = useResource<{ data: Clinic[] }>('/clinics' + query({ q: term }));
  return (
    <Screen title="Find a clinic" tab="Clinics" light>
      <Field
        label="Search clinics or city"
        value={search}
        onChangeText={setSearch}
      />
      <Button secondary title="Search" onPress={() => setTerm(search)} />
      <DataState resource={r} />
      {list(r.data).map(row => (
        <Tile
          key={row.id}
          title={row.name}
          subtitle={`${row.city ?? ''} ${row.address ?? ''}`}
          onPress={() => {
            p.setClinic(row);
            p.setBranch('');
            nav.navigate('ClinicDetails');
          }}
        />
      ))}
      {r.data && !list(r.data).length && (
        <Text style={styles.muted}>
          No published clinics found. The clinic administrator must enable
          patient-app publication.
        </Text>
      )}
      {!p.signedIn && (
        <Button
          secondary
          title="Sign in"
          onPress={() => nav.navigate('Welcome')}
        />
      )}
    </Screen>
  );
}
function ClinicDetails() {
  const p = usePatient(),
    nav = useNavigation<Navigation>(),
    r = useResource<Clinic>(p.clinic ? '/clinics/' + p.clinic.id : null),
    clinic = r.data ?? p.clinic;
  return (
    <Screen title={clinic?.name ?? 'Clinic details'} light>
      <DataState resource={r} />
      {clinic && (
        <>
          <Text style={s.title}>{clinic.name}</Text>
          <Text style={styles.muted}>{clinic.description}</Text>
          <Text style={s.text}>
            {clinic.address} {clinic.city}
          </Text>
          {clinic.phone && (
            <Button
              secondary
              title="Call clinic"
              onPress={() =>
                void Linking.openURL(
                  'tel:' + clinic.phone!.replace(/[^+0-9]/g, ''),
                )
              }
            />
          )}
          <Text style={styles.label}>Choose a branch</Text>
          {r.data?.branches?.map(row => (
            <Tile
              key={row.id}
              title={row.name}
              subtitle={p.branch === row.id ? 'Selected branch' : ''}
              onPress={() => p.setBranch(row.id)}
            />
          ))}
          <Button
            title="View doctors"
            onPress={() => {
              p.setClinic(clinic);
              if (!p.branch && r.data?.branches?.[0])
                p.setBranch(r.data.branches[0].id);
              nav.navigate('Doctors');
            }}
          />
        </>
      )}
    </Screen>
  );
}
function Doctors() {
  const p = usePatient(),
    nav = useNavigation<Navigation>(),
    [search, setSearch] = useState(''),
    [term, setTerm] = useState(''),
    r = useResource<{ data: Doctor[] }>(
      '/doctors' +
        query({
          q: term,
          clinic_id: p.clinic?.id,
          branch_id: p.branch || undefined,
        }),
    );
  return (
    <Screen title="Find a doctor" light>
      <Field
        label="Search doctor or specialty"
        value={search}
        onChangeText={setSearch}
      />
      <Button
        secondary
        title="Search doctors"
        onPress={() => setTerm(search)}
      />
      <DataState resource={r} />
      {p.clinic && (
        <Button
          secondary
          title="Search all clinics"
          onPress={() => {
            p.setClinic(null);
            p.setBranch('');
          }}
        />
      )}
      {list(r.data).map(row => (
        <Tile
          key={row.id}
          title={row.name}
          subtitle={`${row.specialty} · ₹${row.consultation_fee}`}
          onPress={() => {
            const preferred = p.branch;
            p.selectDoctor(row);
            if (row.branch_ids.includes(preferred)) p.setBranch(preferred);
            nav.navigate('DoctorProfile');
          }}
        />
      ))}
      {r.data && !list(r.data).length && (
        <Text style={styles.muted}>
          No published doctors match your search.
        </Text>
      )}
    </Screen>
  );
}
function DoctorProfile() {
  const p = usePatient(),
    nav = useNavigation<Navigation>(),
    r = useResource<Doctor>(
      p.doctor
        ? '/doctors/' +
            p.doctor.id +
            query({ clinic_id: p.doctor.clinic_id, branch_id: p.branch })
        : null,
    ),
    doctor = r.data ?? p.doctor;
  return (
    <Screen title="Doctor profile" light>
      <DataState resource={r} />
      {doctor && (
        <>
          <Avatar doctor size={100} />
          <Text style={s.title}>{doctor.name}</Text>
          <Text style={s.text}>
            {doctor.specialty} · {doctor.qualification}
          </Text>
          <Text style={styles.muted}>{doctor.about}</Text>
          <Text style={s.title}>₹{doctor.consultation_fee}</Text>
          <Button
            title="Choose appointment"
            onPress={() =>
              nav.navigate(p.signedIn ? 'SelectAppointment' : 'Welcome')
            }
          />
        </>
      )}
    </Screen>
  );
}
function SelectAppointment() {
  const p = usePatient(),
    nav = useNavigation<Navigation>(),
    a = useAction(),
    [date, setDate] = useState(today()),
    [loadedDate, setLoadedDate] = useState(date),
    [slot, setSlot] = useState(''),
    key = useRef(uuid()),
    r = useResource<{ slots: { time: string; serial: number }[] }>(
      p.doctor && p.branch
        ? '/doctors/' +
            p.doctor.id +
            '/availability' +
            query({
              clinic_id: p.doctor.clinic_id,
              branch_id: p.branch,
              date: loadedDate,
            })
        : null,
    );
  return (
    <Screen title="Select appointment" light>
      <Text style={s.text}>
        Patient: {p.profile?.name || 'Complete your profile'}
      </Text>
      <Button
        secondary
        title="Change patient"
        onPress={() => nav.navigate('Family')}
      />
      <Field
        label="Appointment date (YYYY-MM-DD)"
        value={date}
        onChangeText={setDate}
      />
      <Button
        secondary
        title="Load available times"
        onPress={() => {
          setSlot('');
          setLoadedDate(date);
          key.current = uuid();
        }}
      />
      <DataState resource={r} />
      <Notice text={a.error} />
      <View style={styles.menu}>
        {r.data?.slots.map(row => (
          <Button
            key={row.time}
            title={row.time}
            secondary={slot !== row.time}
            onPress={() => {
              setSlot(row.time);
              key.current = uuid();
            }}
          />
        ))}
      </View>
      {r.data && !r.data.slots.length && (
        <Text style={styles.muted}>No available slots on this date.</Text>
      )}
      <Button
        title="Continue to visit details"
        disabled={a.busy || !slot || !p.profile?.name || !p.doctor}
        onPress={() =>
          void a.run(async () => {
            const hold = await api.request<{ id: string; expires_at: string }>(
              '/booking-holds',
              'POST',
              {
                profile_id: p.profile!.id,
                clinic_id: p.doctor!.clinic_id,
                branch_id: p.branch,
                doctor_id: p.doctor!.id,
                appointment_date: loadedDate,
                appointment_time: slot,
              },
              { key: key.current },
            );
            p.setHold(hold);
            p.setQuote(null);
            nav.navigate('VisitDetails');
          })
        }
      />
    </Screen>
  );
}
function VisitDetails() {
  const p = usePatient(),
    nav = useNavigation<Navigation>(),
    a = useAction(),
    [reason, setReason] = useState(''),
    [followup, setFollowup] = useState(false),
    [uploads, setUploads] = useState<string[]>([]),
    [share, setShare] = useState(false);
  return (
    <Screen title="Visit details" light>
      <Text style={styles.muted}>
        Your slot is held until{' '}
        {p.hold ? new Date(p.hold.expires_at).toLocaleTimeString() : ''}.
        Availability will be checked again by the server.
      </Text>
      <Field
        label="Reason for visit"
        multiline
        value={reason}
        onChangeText={setReason}
      />
      <Button
        secondary
        title={followup ? 'Follow-up visit' : 'New visit'}
        onPress={() => setFollowup(!followup)}
      />
      <Button
        secondary
        title={
          share
            ? 'Sharing consent enabled'
            : 'Allow the clinic to access attached files'
        }
        onPress={() => setShare(!share)}
      />
      <Notice text={a.error} />
      <Button
        secondary
        title={`Attach PDF / image (${uploads.length}/10)`}
        disabled={a.busy || !share || uploads.length >= 10}
        onPress={() =>
          void a.run(async () => {
            const file = await chooseFile();
            if (!file) return;
            const upload = await api.request<{ id: string }>(
              '/uploads',
              'POST',
              { ...file, profile_id: p.profile!.id, share_with_clinic: true },
            );
            setUploads(old => [...old, upload.id]);
          })
        }
      />
      <Button
        title="Review booking"
        disabled={a.busy || !p.hold}
        onPress={() =>
          void a.run(async () => {
            await api.request('/booking-holds/' + p.hold!.id, 'PATCH', {
              reason,
              visit_type: followup ? 'Follow-up' : 'New',
              upload_ids: uploads,
            });
            const quote = await api.request<Quote>('/booking-quotes', 'POST', {
              hold_id: p.hold!.id,
            });
            p.setQuote(quote);
            nav.navigate('Payment');
          })
        }
      />
    </Screen>
  );
}
function Payment() {
  const p = usePatient(),
    nav = useNavigation<Navigation>(),
    a = useAction(),
    key = useRef(uuid()),
    orderKey = useRef(uuid()),
    [payment, setPayment] = useState<{
      id: string;
      provider_order_id: string;
      key_id: string;
      amount_cents: number;
      currency: string;
      appointment_id?: string;
    } | null>(null);
  const finish = async (id: string) => {
    p.setAppointment(await api.request<Appointment>('/appointments/' + id));
    p.setHold(null);
    p.setQuote(null);
    nav.reset({
      index: 1,
      routes: [{ name: 'Home' }, { name: 'Confirmation' }],
    });
  };
  return (
    <Screen title="Review & payment" light>
      <Text style={s.title}>{p.doctor?.name}</Text>
      <Text style={s.text}>Patient: {p.profile?.name}</Text>
      <Text style={s.title}>
        ₹{((p.quote?.total_cents ?? 0) / 100).toFixed(2)}
      </Text>
      <Text style={styles.muted}>
        The amount comes from the clinic’s server. Quote expires at{' '}
        {p.quote ? new Date(p.quote.expires_at).toLocaleTimeString() : ''}.
      </Text>
      <Notice text={a.error} />
      <Button
        title="Confirm & pay at clinic"
        disabled={a.busy || !p.quote?.payment_options.pay_at_clinic}
        onPress={() =>
          Alert.alert(
            'Confirm appointment',
            'You will pay the displayed amount at the clinic.',
            [
              { text: 'Back' },
              {
                text: 'Confirm',
                onPress: () =>
                  void a.run(async () => {
                    const row = await api.request<Appointment>(
                      '/appointments',
                      'POST',
                      { quote_id: p.quote!.id, pay_at_clinic: true },
                      { key: key.current },
                    );
                    await finish(row.id);
                  }),
              },
            ],
          )
        }
      />
      <Button
        secondary
        title="Pay online with Razorpay"
        disabled={a.busy || !p.quote?.payment_options.online}
        onPress={() =>
          Alert.alert(
            'Online payment',
            `Continue to secure checkout for ₹${(
              (p.quote?.total_cents ?? 0) / 100
            ).toFixed(2)}?`,
            [
              { text: 'Cancel' },
              {
                text: 'Continue',
                onPress: () =>
                  void a.run(async () => {
                    const order =
                      payment ??
                      (await api.request<NonNullable<typeof payment>>(
                        '/payment-orders',
                        'POST',
                        { quote_id: p.quote!.id },
                        { key: orderKey.current },
                      ));
                    setPayment(order);
                    const checkout = await Razorpay.open({
                      key: order.key_id,
                      order_id: order.provider_order_id,
                      amount: order.amount_cents,
                      currency: order.currency,
                      name: 'Pushkar Clinic',
                      description: 'Doctor appointment',
                      prefill: {
                        name: p.profile?.name ?? '',
                        contact: p.me?.phone ?? '',
                      },
                    });
                    const verified = await api.request<{
                      appointment_id?: string;
                    }>('/payments/' + order.id + '/verify', 'POST', {
                      payment_id: checkout.razorpay_payment_id,
                      signature: checkout.razorpay_signature,
                    });
                    if (!verified.appointment_id)
                      throw Error(
                        'Payment is awaiting clinic confirmation. Use Check payment status; do not pay again.',
                      );
                    await finish(verified.appointment_id);
                  }),
              },
            ],
          )
        }
      />
      {payment && (
        <Button
          secondary
          title="Check payment status (do not pay again)"
          disabled={a.busy}
          onPress={() =>
            void a.run(async () => {
              const status = await api.request<{
                appointment_id?: string;
                status: string;
              }>('/payments/' + payment.id + '/sync', 'POST', {});
              if (status.appointment_id) await finish(status.appointment_id);
              else
                throw Error(
                  `Payment status: ${status.status}. Contact reception before attempting another payment.`,
                );
            })
          }
        />
      )}
      <Text style={styles.muted}>
        Only payment methods enabled by the clinic are available. A failed
        network response is not proof that payment failed.
      </Text>
    </Screen>
  );
}
function Confirmation() {
  const p = usePatient(),
    nav = useNavigation<Navigation>(),
    a = useAction();
  return (
    <Screen title="Booking confirmed" light>
      <Text style={s.title}>Your appointment is booked</Text>
      {p.appointment && <Details value={{ ...p.appointment }} />}
      <Notice text={a.error} />
      <Button
        title="View appointment"
        onPress={() => nav.navigate('AppointmentDetails')}
      />
      <Button
        secondary
        title="Download appointment pass"
        disabled={a.busy || !p.appointment}
        onPress={() =>
          void a.run(() =>
            downloadDocument(
              '/appointments/' + p.appointment!.id + '/pass?format=pdf',
            ),
          )
        }
      />
    </Screen>
  );
}
function Appointments() {
  const p = usePatient(),
    nav = useNavigation<Navigation>(),
    [status, setStatus] = useState('upcoming'),
    r = useResource<{ data: Appointment[] }>(
      '/appointments' + query({ patient_id: p.profile?.id, status }),
    );
  return (
    <Screen title="My appointments" tab="Appointments" light>
      <View style={styles.menu}>
        {['upcoming', 'past', 'cancelled', 'all'].map(v => (
          <Button
            key={v}
            title={v}
            secondary={status !== v}
            onPress={() => setStatus(v)}
          />
        ))}
      </View>
      <DataState resource={r} />
      {list(r.data).map(row => (
        <Tile
          key={row.id}
          title={row.doctor_name ?? row.appointment_number}
          subtitle={`${row.patient_name} · ${row.appointment_date} ${row.appointment_time} · ${row.status}`}
          onPress={() => {
            p.setAppointment(row);
            nav.navigate('AppointmentDetails');
          }}
        />
      ))}
      {r.data && !list(r.data).length && (
        <Text style={styles.muted}>No appointments in this category.</Text>
      )}
    </Screen>
  );
}
function AppointmentDetails() {
  const p = usePatient(),
    nav = useNavigation<Navigation>(),
    a = useAction(),
    r = useResource<
      Appointment & {
        can_reschedule: boolean;
        cancellation_policy: { can_cancel: boolean };
      }
    >(p.appointment ? '/appointments/' + p.appointment.id : null),
    [reason, setReason] = useState(''),
    [date, setDate] = useState(''),
    [time, setTime] = useState(''),
    rescheduleKey = useRef(uuid());
  const row = r.data ?? p.appointment;
  return (
    <Screen title="Appointment details" light>
      <DataState resource={r} />
      <Notice text={a.error} />
      {row && (
        <>
          <Details value={{ ...row }} />
          <Button
            title="Live queue"
            onPress={() => {
              p.setAppointment(row);
              nav.navigate('Queue');
            }}
          />
          <Button
            secondary
            title="Check in"
            onPress={() => {
              p.setAppointment(row);
              nav.navigate('CheckIn');
            }}
          />
          <Button
            secondary
            title="Download pass"
            disabled={a.busy}
            onPress={() =>
              void a.run(() =>
                downloadDocument(
                  '/appointments/' + row.id + '/pass?format=pdf',
                ),
              )
            }
          />
          {r.data?.can_reschedule && (
            <>
              <Field
                label="New date (YYYY-MM-DD)"
                value={date}
                onChangeText={v => {
                  setDate(v);
                  rescheduleKey.current = uuid();
                }}
              />
              <Field
                label="New time (HH:mm)"
                value={time}
                onChangeText={v => {
                  setTime(v);
                  rescheduleKey.current = uuid();
                }}
              />
              <Button
                secondary
                title="Reschedule appointment"
                disabled={a.busy || !date || !time}
                onPress={() =>
                  Alert.alert(
                    'Reschedule appointment',
                    `Move to ${date} at ${time}?`,
                    [
                      { text: 'Keep current' },
                      {
                        text: 'Reschedule',
                        onPress: () =>
                          void a.run(async () => {
                            await api.request(
                              '/appointments/' + row.id + '/reschedule',
                              'POST',
                              {
                                appointment_date: date,
                                appointment_time: time,
                                updated_at: r.data!.updated_at,
                              },
                              { key: rescheduleKey.current },
                            );
                            r.reload();
                          }),
                      },
                    ],
                  )
                }
              />
            </>
          )}
          {r.data?.cancellation_policy.can_cancel && (
            <>
              <Field
                label="Cancellation reason"
                value={reason}
                onChangeText={setReason}
              />
              <Button
                secondary
                title="Request cancellation"
                disabled={a.busy || reason.trim().length < 3}
                onPress={() =>
                  Alert.alert(
                    'Cancel appointment?',
                    'Paid cancellations and refunds require clinic review.',
                    [
                      { text: 'Keep booking' },
                      {
                        text: 'Request cancellation',
                        style: 'destructive',
                        onPress: () =>
                          void a.run(async () => {
                            await api.request(
                              '/appointments/' + row.id + '/cancel',
                              'POST',
                              { reason: reason.trim() },
                            );
                            r.reload();
                          }),
                      },
                    ],
                  )
                }
              />
            </>
          )}
        </>
      )}
    </Screen>
  );
}
function CheckIn() {
  const p = usePatient(),
    a = useAction(),
    pass = useResource<{ qr_payload: string }>(
      p.appointment ? '/appointments/' + p.appointment.id + '/pass' : null,
    ),
    [qr, setQr] = useState(''),
    [result, setResult] = useState<Item | null>(null);
  return (
    <Screen title="Patient check-in" light>
      <DataState resource={pass} />
      {pass.data && (
        <View style={{ alignItems: 'center', padding: 20 }}>
          <QRCode value={pass.data.qr_payload} size={200} />
          <Text style={styles.muted}>
            Show this appointment pass at reception.
          </Text>
        </View>
      )}
      <Text style={styles.muted}>
        Check in only after arriving. If the clinic requires its signed QR code,
        paste that code below or ask reception to check you in.
      </Text>
      <Field
        label="Clinic QR code (when required)"
        value={qr}
        onChangeText={setQr}
      />
      <Notice text={a.error} />
      {result && <Details value={result} />}
      <Button
        title="I have arrived — check in"
        disabled={a.busy || !p.appointment}
        onPress={() =>
          void a.run(async () => {
            const row = await api.request<Item>(
              '/appointments/' + p.appointment!.id + '/check-in',
              'POST',
              qr ? { clinic_qr: qr } : {},
            );
            setResult(row);
          })
        }
      />
    </Screen>
  );
}
function Queue() {
  const p = usePatient(),
    nav = useNavigation<Navigation>(),
    r = useResource<{
      queue_enabled: boolean;
      queue_status: string;
      token: string;
      now_serving_token: string;
      patients_ahead: number;
      estimated_wait_minutes: number | null;
      room: string;
    }>(
      p.appointment ? '/appointments/' + p.appointment.id + '/queue' : null,
      5000,
    );
  const q = r.data;
  return (
    <Screen title="Live OPD queue" light>
      <DataState resource={r} />
      {q && (
        <>
          {!q.queue_enabled ? (
            <Text style={styles.muted}>
              Live queue is not enabled for this doctor.
            </Text>
          ) : (
            <>
              <Tile
                title={`Your token: ${q.token ?? 'Awaiting token'}`}
                subtitle={q.queue_status}
              />
              <Tile
                title={`Now serving: ${q.now_serving_token ?? 'Not started'}`}
                subtitle={`${q.patients_ahead} patients ahead`}
              />
              <Text style={s.title}>
                {q.queue_status === 'In Consultation'
                  ? 'It’s your turn'
                  : q.estimated_wait_minutes === null
                  ? 'Waiting time unavailable'
                  : `Approx. ${q.estimated_wait_minutes} minutes`}
              </Text>
              <Text style={s.text}>
                Consultation room: {q.room || 'Ask reception'}
              </Text>
              <Text style={styles.muted}>
                Updates every five seconds while this screen is open. Estimated
                times can change.
              </Text>
              <Button
                secondary
                title="Turn alert"
                onPress={() => nav.navigate('TurnAlert')}
              />
            </>
          )}
        </>
      )}
    </Screen>
  );
}
function Records() {
  const p = usePatient(),
    nav = useNavigation<Navigation>(),
    a = useAction(),
    r = useResource<{ data: Item[] }>(
      '/records' + query({ patient_id: p.profile?.id }),
    ),
    [title, setTitle] = useState('');
  return (
    <Screen title="Medical records" tab="Records" light>
      <DataState resource={r} />
      <Notice text={a.error} />
      <Text style={styles.muted}>
        Only clinic-released records and your own uploads appear here.
      </Text>
      {list(r.data).map(row => (
        <Tile
          key={row.id}
          title={row.title ?? 'Medical record'}
          subtitle={`${row.kind ?? ''} · ${row.record_date ?? ''}`}
          onPress={() => {
            p.setRecord(row);
            nav.navigate('Prescription');
          }}
        />
      ))}
      {r.data && !list(r.data).length && (
        <Text style={styles.muted}>No released records yet.</Text>
      )}
      <Field
        label="Title for a new personal record"
        value={title}
        onChangeText={setTitle}
      />
      <Button
        secondary
        title="Upload a personal PDF or image"
        disabled={a.busy || !title.trim()}
        onPress={() =>
          void a.run(async () => {
            const file = await chooseFile();
            if (!file) return;
            const upload = await api.request<{ id: string }>(
              '/uploads',
              'POST',
              { ...file, profile_id: p.profile!.id, share_with_clinic: false },
            );
            await api.request(
              '/records',
              'POST',
              {
                profile_id: p.profile!.id,
                upload_id: upload.id,
                title: title.trim(),
                record_date: today(),
              },
              { key: uuid() },
            );
            setTitle('');
            r.reload();
          })
        }
      />
    </Screen>
  );
}
function Prescription() {
  const p = usePatient(),
    a = useAction(),
    row = p.record;
  return (
    <Screen title={row?.title ?? 'Medical document'} light>
      <Notice text={a.error} />
      {row ? (
        <>
          <Details value={row} />
          <Button
            title="Open private document"
            disabled={a.busy}
            onPress={() =>
              void a.run(() =>
                downloadDocument('/records/' + row.id + '/download'),
              )
            }
          />
        </>
      ) : (
        <Text style={styles.muted}>Select a released record first.</Text>
      )}
    </Screen>
  );
}
function LabReports() {
  const p = usePatient(),
    a = useAction(),
    r = useResource<{ data: Item[] }>(
      '/lab-orders' + query({ patient_id: p.profile?.id }),
    ),
    catalog = useResource<{ data: Item[] }>(
      p.clinic && p.branch
        ? '/lab-tests' + query({ clinic_id: p.clinic.id, branch_id: p.branch })
        : null,
    ),
    [tests, setTests] = useState<string[]>([]);
  return (
    <Screen title="Lab tests & reports" light>
      <DataState resource={r} />
      <Notice text={a.error} />
      {list(r.data).map(row => (
        <View key={row.id}>
          <Details value={row} />
          {row.report && typeof row.report === 'object' && (
            <Button
              secondary
              title="Open released report"
              onPress={() =>
                void a.run(async () => {
                  const report = row.report as { id?: string };
                  if (!report.id)
                    throw Error('A report has not been released yet.');
                  await downloadDocument('/records/' + report.id + '/download');
                })
              }
            />
          )}
        </View>
      ))}
      {r.data && !list(r.data).length && (
        <Text style={styles.muted}>No lab orders yet.</Text>
      )}
      <Text style={s.title}>Request lab tests</Text>
      {!p.clinic || !p.branch ? (
        <Text style={styles.muted}>
          Choose a clinic and branch first to see bookable tests.
        </Text>
      ) : (
        <>
          <DataState resource={catalog} />
          {list(catalog.data).map(row => (
            <Tile
              key={row.id}
              title={`${tests.includes(row.id) ? '✓ ' : ''}${
                row.name ?? 'Lab test'
              }`}
              subtitle={asText(row.price)}
              onPress={() =>
                setTests(old =>
                  old.includes(row.id)
                    ? old.filter(id => id !== row.id)
                    : [...old, row.id],
                )
              }
            />
          ))}
          <Button
            title="Request clinic confirmation"
            disabled={a.busy || !tests.length}
            onPress={() =>
              void a.run(async () => {
                await api.request(
                  '/lab-bookings',
                  'POST',
                  {
                    profile_id: p.profile!.id,
                    clinic_id: p.clinic!.id,
                    branch_id: p.branch,
                    test_ids: tests,
                  },
                  { key: uuid() },
                );
                setTests([]);
                r.reload();
              })
            }
          />
        </>
      )}
    </Screen>
  );
}
function Invoices() {
  const p = usePatient(),
    a = useAction(),
    r = useResource<{ data: Item[] }>(
      '/invoices' + query({ patient_id: p.profile?.id }),
    ),
    payments = useResource<{ data: Item[] }>(
      '/payments' + query({ patient_id: p.profile?.id }),
    );
  return (
    <Screen title="Payments & invoices" light>
      <DataState resource={r} />
      <Notice text={a.error} />
      {list(r.data).map(row => (
        <View key={row.id}>
          <Details value={row} />
          <Button
            secondary
            title="Open invoice"
            onPress={() =>
              void a.run(() =>
                downloadDocument('/invoices/' + row.id + '/download'),
              )
            }
          />
        </View>
      ))}
      <Text style={s.title}>Online payment history</Text>
      <DataState resource={payments} />
      {list(payments.data).map(row => (
        <Tile
          key={row.id}
          title={`${asText(row.status)} · ₹${
            Number(row.amount_cents ?? 0) / 100
          }`}
          subtitle={asText(row.created_at)}
        />
      ))}
    </Screen>
  );
}
function Notifications() {
  const a = useAction(),
    r = useResource<{ data: Item[] }>('/notifications', 15000);
  return (
    <Screen title="Notifications" light>
      <DataState resource={r} />
      <Notice text={a.error} />
      <Button
        secondary
        title="Mark all as read"
        disabled={a.busy}
        onPress={() =>
          void a.run(async () => {
            await api.request('/notifications/read-all', 'POST');
            r.reload();
          })
        }
      />
      {list(r.data).map(row => (
        <Tile
          key={row.id}
          title={row.title ?? 'Clinic notification'}
          subtitle={asText(row.message) || asText(row.body)}
          onPress={() =>
            void a.run(async () => {
              await api.request('/notifications/' + row.id, 'PATCH', {
                read: true,
              });
              r.reload();
            })
          }
        />
      ))}
      {r.data && !list(r.data).length && (
        <Text style={styles.muted}>No notifications.</Text>
      )}
      <Text style={styles.muted}>
        In-app notifications are connected. Background push delivery will be
        available after the push service is configured.
      </Text>
    </Screen>
  );
}
function Account() {
  const p = usePatient(),
    nav = useNavigation<Navigation>(),
    a = useAction(),
    [code, setCode] = useState(''),
    [subject, setSubject] = useState(''),
    [message, setMessage] = useState(''),
    [success, setSuccess] = useState('');
  return (
    <Screen title="Account & help" tab="Account" light>
      <Text style={s.title}>{p.me?.profile.name}</Text>
      <Text style={s.text}>{p.me?.phone}</Text>
      <Notice text={a.error} />
      {success && <Text style={styles.muted}>{success}</Text>}
      <Button
        secondary
        title="Edit profile"
        onPress={() => nav.navigate('Profile')}
      />
      <Button
        secondary
        title="Manage family"
        onPress={() => nav.navigate('Family')}
      />
      <Text style={s.title}>Link an existing clinic record</Text>
      <Text style={styles.muted}>
        Ask clinic staff for a one-time, phone-bound linking code. Matching a
        phone number alone does not grant access to medical records.
      </Text>
      <Field label="Clinic linking code" value={code} onChangeText={setCode} />
      <Button
        secondary
        title="Link record"
        disabled={a.busy || !code.trim()}
        onPress={() =>
          void a.run(async () => {
            await api.request('/clinic-links', 'POST', {
              profile_id: p.profile!.id,
              code: code.trim(),
            });
            setCode('');
            setSuccess(
              'Clinic record linked. Open Medical records to see released documents.',
            );
          })
        }
      />
      <Text style={s.title}>Contact clinic support</Text>
      <Field label="Subject" value={subject} onChangeText={setSubject} />
      <Field
        label="Message"
        multiline
        value={message}
        onChangeText={setMessage}
      />
      <Button
        secondary
        title="Send support request"
        disabled={a.busy || !p.clinic || !subject.trim() || !message.trim()}
        onPress={() =>
          void a.run(async () => {
            await api.request(
              '/support-tickets',
              'POST',
              {
                clinic_id: p.clinic!.id,
                profile_id: p.profile!.id,
                subject,
                message,
              },
              { key: uuid() },
            );
            setSubject('');
            setMessage('');
            setSuccess('Support request sent.');
          })
        }
      />
      <Button
        secondary
        title="Request account deletion"
        disabled={a.busy}
        onPress={() =>
          Alert.alert(
            'Request deletion?',
            'This signs you out and sends a deletion request for review. Clinic medical and financial records are retained.',
            [
              { text: 'Keep account' },
              {
                text: 'Request deletion',
                style: 'destructive',
                onPress: () =>
                  void a.run(async () => {
                    await api.request('/account-deletion-requests', 'POST', {
                      reason: 'Requested from the patient app',
                    });
                    await p.logout();
                    nav.reset({ index: 0, routes: [{ name: 'Welcome' }] });
                  }),
              },
            ],
          )
        }
      />
      <Button
        title="Sign out"
        disabled={a.busy}
        onPress={() =>
          void a.run(async () => {
            await p.logout();
            nav.reset({ index: 0, routes: [{ name: 'Welcome' }] });
          })
        }
      />
      <Menu />
    </Screen>
  );
}
const components: Record<ScreenName, React.ComponentType> = {
  Welcome,
  OTP,
  Profile: ProfileScreen,
  Family,
  Home,
  Clinics,
  ClinicDetails,
  Doctors,
  DoctorProfile,
  SelectAppointment,
  VisitDetails,
  Payment,
  Confirmation,
  Appointments,
  AppointmentDetails,
  CheckIn,
  Queue,
  TurnAlert: Queue,
  Records,
  Prescription,
  LabReports,
  Invoices,
  Notifications,
  Account,
};
const publicScreens = new Set<ScreenName>([
  'Welcome',
  'OTP',
  'Clinics',
  'ClinicDetails',
  'Doctors',
  'DoctorProfile',
]);
export const liveScreens = Object.fromEntries(
  Object.entries(components).map(([key, Component]) => [
    key,
    function ConnectedScreen() {
      const p = usePatient(),
        nav = useNavigation<Navigation>();
      if (!p.ready)
        return (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.blue} />
          </View>
        );
      if (!p.signedIn && !publicScreens.has(key as ScreenName))
        return (
          <Screen title="Sign in to continue" light>
            <Text style={styles.muted}>
              Use your own verified phone number to book visits and access
              private records.
            </Text>
            <Button
              title="Sign in"
              onPress={() =>
                nav.reset({ index: 0, routes: [{ name: 'Welcome' }] })
              }
            />
          </Screen>
        );
      return <Component />;
    },
  ]),
) as Record<ScreenName, React.ComponentType>;
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d6e7f1',
    borderRadius: 18,
    padding: 18,
    marginVertical: 8,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#12334f' },
  muted: { color: '#567189', lineHeight: 23, marginVertical: 12 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#567189',
    textTransform: 'capitalize',
    marginBottom: 5,
  },
  error: {
    color: '#a32135',
    backgroundColor: '#fff0f1',
    padding: 14,
    borderRadius: 12,
    marginVertical: 10,
  },
  menu: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 14 },
  pill: { backgroundColor: '#e7f4fc', padding: 12, borderRadius: 12 },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f9ff',
  },
});
