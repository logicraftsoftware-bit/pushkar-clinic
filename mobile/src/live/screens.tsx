import { PatientAuth } from './AuthScreens';
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
import { Bell, CalendarPlus, ClipboardList, FileText, HeartPulse, Receipt, Users, UserRound, CircleHelp } from 'lucide-react-native';
import { Button, Field, Screen, SearchBar } from '../components/ui';
import { DateField } from '../components/DateField';
import { Avatar, ClinicArt } from '../components/Illustrations';
import { colors, s } from '../theme';
import type { Navigation, ScreenName } from '../navigation';
import { api, chooseFile, downloadDocument } from './native';
import { ApiError } from './client';
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
      setBusy(Boolean(path) || revision > 0);
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
  leading,
  trailing,
}: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.card, onPress && pressed && styles.cardPressed]}
    >
      <View style={styles.tileRow}>
        {leading}
        <View style={styles.tileBody}>
          <Text style={styles.cardTitle}>{title}</Text>
          {subtitle ? <Text style={styles.tileSubtitle}>{subtitle}</Text> : null}
        </View>
        {trailing ?? (onPress ? <Text style={styles.chevron}>›</Text> : null)}
      </View>
    </Pressable>
  );
}
function Segments({ values, selected, onChange }: {
  values: string[];
  selected: string;
  onChange: (value: string) => void;
}) {
  return <View style={styles.segments}>
    {values.map(value => (
      <Pressable key={value} accessibilityRole="tab"
        accessibilityState={{ selected: value === selected }}
        onPress={() => onChange(value)}
        style={[styles.segment, value === selected && styles.activeSegment]}>
        <Text style={[styles.segmentText, value === selected && styles.activeSegmentText]}>
          {value.charAt(0).toUpperCase() + value.slice(1)}
        </Text>
      </Pressable>
    ))}
  </View>;
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
          <View key={key} style={styles.detailRow}>
            <Text style={styles.detailLabel}>{key.replace(/_/g, ' ')}</Text>
            <Text style={styles.detailValue}>{format(value[key])}</Text>
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
function SettingRow({ title, icon: Icon, onPress }: {
  title: string;
  icon: typeof Bell;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.settingRow}>
      <Icon size={19} color="#07598e" />
      <Text style={[styles.cardTitle, styles.tileBody]}>{title}</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
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
    <Screen title="Patient profile" light>
      <View style={styles.doctorHero}><Avatar size={82} /></View>
      <Field label="Full name" value={name} onChangeText={setName} />
      <DateField
        label="Date of birth"
        value={dob}
        onSelect={setDob}
        max={today()}
      />
      <Text style={styles.label}>Gender</Text>
      <Segments values={['Male', 'Female', 'Other']} selected={sex} onChange={setSex} />
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
            leading={<Avatar size={46} />}
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
      <DateField
        label="Date of birth"
        value={dob}
        onSelect={setDob}
        max={today()}
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
    <Screen title="Pushkar Clinic" tab="Home" light>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Hello, {p.profile?.name || 'welcome'}</Text>
        <Avatar size={46} />
      </View>
      <DataState resource={r} />
      <View style={styles.shortcuts}>
        {([
          ['Clinics', CalendarPlus, 'Book visit'],
          ['Queue', HeartPulse, 'Live queue'],
          ['LabReports', ClipboardList, 'Reports'],
          ['Records', FileText, 'Records'],
        ] as const).map(([route, Icon, label]) => (
          <Pressable key={route} style={styles.shortcut} accessibilityRole="button"
            onPress={() => {
              if (route === 'Queue') {
                const upcoming = r.data?.upcoming_appointments[0];
                if (!upcoming) return nav.navigate('Appointments');
                p.setAppointment(upcoming);
              }
              nav.navigate(route);
            }}>
            <Icon size={22} color="#07598e" />
            <Text style={styles.segmentText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.sectionTitle}>Upcoming appointments</Text>
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
      <View style={styles.settingsGroup}>
        <SettingRow title="Find a doctor" icon={HeartPulse} onPress={() => nav.navigate('Doctors')} />
        <SettingRow title="Notifications" icon={Bell} onPress={() => nav.navigate('Notifications')} />
        <SettingRow title="Payments & invoices" icon={Receipt} onPress={() => nav.navigate('Invoices')} />
      </View>
    </Screen>
  );
}
function Clinics() {
  const p = usePatient(),
    nav = useNavigation<Navigation>(),
    [search, setSearch] = useState(''),
    [term, setTerm] = useState(''),
    r = useResource<{ data: Clinic[] }>('/clinics' + query({ q: term }));
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);
  return (
    <Screen title="Find a clinic" tab="Clinics" light>
      <SearchBar
        placeholder="Search clinics or city"
        value={search}
        onChangeText={setSearch}
      />
      <DataState resource={r} />
      {list(r.data).map(row => (
        <Tile
          key={row.id}
          title={row.name}
          subtitle={`${row.city ?? ''} ${row.address ?? ''}`}
          leading={<View style={styles.clinicThumb}><ClinicArt width={76} height={60} /></View>}
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
    <Screen title="Clinic details" light>
      <DataState resource={r} />
      {clinic && (
        <>
          <View style={styles.clinicBanner}><ClinicArt width="100%" height={160} /></View>
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
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);
  return (
    <Screen title="Find a doctor" light>
      <SearchBar
        placeholder="Search doctor or specialty"
        value={search}
        onChangeText={setSearch}
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
          subtitle={row.specialty}
          leading={<Avatar doctor size={48} />}
          trailing={<Text style={styles.chevron}>₹{row.consultation_fee}</Text>}
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
          <View style={styles.doctorHero}>
            <Avatar doctor size={96} />
            <Text style={s.title}>{doctor.name}</Text>
            <Text style={styles.tileSubtitle}>{doctor.specialty}</Text>
          </View>
          <Text style={styles.sectionTitle}>About</Text>
          {doctor.qualification ? <Tile title="Qualifications" subtitle={doctor.qualification} /> : null}
          {doctor.about ? <Text style={styles.muted}>{doctor.about}</Text> : null}
          <Tile title="Consultation fee" trailing={<Text style={styles.chevron}>₹{doctor.consultation_fee}</Text>} />
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
              date,
            })
        : null,
    );
  return (
    <Screen title="Select appointment" light>
      <Tile title={p.profile?.name || 'Choose a patient'} subtitle="Patient" leading={<Avatar size={42} />} onPress={() => nav.navigate('Family')} />
      <DateField
        label="Appointment date"
        value={date}
        min={today()}
        onSelect={selected => {
          setSlot('');
          setDate(selected);
          key.current = uuid();
        }}
      />
      <DataState resource={r} />
      <Notice text={a.error} />
      <Text style={styles.sectionTitle}>Available times</Text>
      <View style={styles.menu}>
        {r.data?.slots.map(row => (
          <Pressable
            key={row.time}
            accessibilityRole="button"
            accessibilityState={{ selected: slot === row.time }}
            style={[styles.timeSlot, slot === row.time && styles.activeSegment]}
            onPress={() => {
              setSlot(row.time);
              key.current = uuid();
            }}
          >
            <Text style={[styles.segmentText, slot === row.time && styles.activeSegmentText]}>{row.time}</Text>
          </Pressable>
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
            if (p.hold) {
              try {
                await api.request('/booking-holds/' + p.hold.id, 'DELETE');
              } catch (error) {
                if (
                  !(error instanceof ApiError) ||
                  ![404, 409].includes(error.status)
                )
                  throw error;
              }
              p.setHold(null);
              key.current = uuid();
            }
            const hold = await api.request<{ id: string; expires_at: string }>(
              '/booking-holds',
              'POST',
              {
                profile_id: p.profile!.id,
                clinic_id: p.doctor!.clinic_id,
                branch_id: p.branch,
                doctor_id: p.doctor!.id,
                appointment_date: date,
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
    [uploads, setUploads] = useState<{ id: string; filename: string }[]>([]),
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
      <View style={styles.formCard}>
      <Text style={styles.sectionTitle}>Visit attachments</Text>
      <Text style={styles.tileSubtitle}>PDF or image · {uploads.length} of 10 files attached</Text>
      {uploads.map(file => <Tile key={file.id} title={file.filename} subtitle="Tap to remove from this visit"
        onPress={() => setUploads(current => current.filter(item => item.id !== file.id))} />)}
      <Button
        secondary
        title="Choose PDF or image"
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
            setUploads(old => [...old, { id: upload.id, filename: file.filename }]);
          })
        }
      />
      </View>
      <Button
        title="Review booking"
        disabled={a.busy || !p.hold}
        onPress={() =>
          void a.run(async () => {
            await api.request('/booking-holds/' + p.hold!.id, 'PATCH', {
              reason,
              visit_type: followup ? 'Follow-up' : 'New',
              upload_ids: share ? uploads.map(file => file.id) : [],
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
  useEffect(() => {
    key.current = uuid();
    orderKey.current = uuid();
    setPayment(null);
  }, [p.quote?.id]);
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
      <Text style={styles.sectionTitle}>Booking summary</Text>
      <Tile title={p.doctor?.name ?? 'Consultation'} subtitle={p.doctor?.specialty} leading={<Avatar doctor size={48} />} />
      <Tile title="Patient" subtitle={p.profile?.name} />
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
      <View style={styles.doctorHero}>
        <Text style={styles.confirmIcon}>✓</Text>
        <Text style={s.title}>Appointment confirmed!</Text>
        {p.appointment && <Text style={styles.tileSubtitle}>{p.appointment.appointment_number}</Text>}
      </View>
      {p.appointment && <Details value={{ ...p.appointment }} />}
      <Notice text={a.error} />
      <Button
        title="View appointment"
        onPress={() => nav.navigate('AppointmentDetails')}
      />
      <Tile title="Back to Home" onPress={() => nav.navigate('Home')} />
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
      <Segments values={['upcoming', 'past', 'cancelled', 'all']} selected={status} onChange={setStatus} />
      <DataState resource={r} />
      {list(r.data).map(row => (
        <Tile
          key={row.id}
          title={row.doctor_name ?? row.appointment_number}
          leading={<Avatar doctor size={44} />}
          subtitle={`${row.clinic_name ?? row.patient_name ?? ''}\n${row.appointment_date} · ${row.appointment_time}`}
          trailing={<Text style={styles.statusChip}>{row.status}</Text>}
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
  const [change, setChange] = useState<'reschedule' | 'cancel' | null>(null);
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
          <Tile title={row.doctor_name ?? 'Appointment'} subtitle={row.clinic_name} leading={<Avatar doctor size={48} />} trailing={<Text style={styles.chevron}>{row.status}</Text>} />
          <Details value={{ ...row, doctor_name: undefined, clinic_name: undefined, status: undefined }} />
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
          {r.data?.can_reschedule && <SettingRow title="Reschedule appointment" icon={CalendarPlus} onPress={() => setChange(change === 'reschedule' ? null : 'reschedule')} />}
          {r.data?.can_reschedule && change === 'reschedule' && (
            <View style={styles.formCard}>
              <DateField
                label="New appointment date"
                value={date}
                min={today()}
                onSelect={v => {
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
            </View>
          )}
          {r.data?.cancellation_policy.can_cancel && <SettingRow title="Cancel appointment" icon={CalendarPlus} onPress={() => setChange(change === 'cancel' ? null : 'cancel')} />}
          {r.data?.cancellation_policy.can_cancel && change === 'cancel' && (
            <View style={styles.formCard}>
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
            </View>
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
        <View style={[styles.card, styles.doctorHero]}>
          <QRCode value={pass.data.qr_payload} size={200} />
          <Text style={styles.sectionTitle}>Check in at the clinic</Text>
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
function Queue({ alert = false }: { alert?: boolean } = {}) {
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
    <Screen title={alert ? 'Turn alert' : 'Live queue'} light>
      <DataState resource={r} />
      {q && (
        <>
          {!q.queue_enabled ? (
            <Text style={styles.muted}>
              Live queue is not enabled for this doctor.
            </Text>
          ) : (
            <>
              <Tile title={p.appointment?.doctor_name ?? 'Your appointment'} leading={<Avatar doctor size={44} />} subtitle={q.queue_status} />
              <View style={[styles.queueToken, alert && styles.hero]}>
                <Text style={alert ? styles.heroTitle : styles.sectionTitle}>
                  {alert && q.queue_status === 'In Consultation' ? 'It’s your turn' : 'Your token'}
                </Text>
                <Text style={[styles.tokenNumber, alert && styles.activeSegmentText]}>{q.token ?? 'Awaiting token'}</Text>
              </View>
              <View style={styles.queueStats}>
                <View style={styles.stat}><Text style={styles.tileSubtitle}>Now serving</Text><Text style={styles.cardTitle}>{q.now_serving_token ?? 'Not started'}</Text></View>
                <View style={styles.stat}><Text style={styles.tileSubtitle}>Patients ahead</Text><Text style={styles.cardTitle}>{q.patients_ahead}</Text></View>
              </View>
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
              {!alert && <Button
                secondary
                title="Turn alert"
                onPress={() => nav.navigate('TurnAlert')}
              />}
            </>
          )}
        </>
      )}
    </Screen>
  );
}
function Records() {
  const [showUpload, setShowUpload] = useState(false);
  const p = usePatient(),
    nav = useNavigation<Navigation>(),
    a = useAction(),
    r = useResource<{ data: Item[] }>(
      '/records' + query({ patient_id: p.profile?.id }),
    ),
    [title, setTitle] = useState(''),
    [category, setCategory] = useState('all');
  const records = list(r.data).filter(row => {
    const kind = (row.kind ?? '').toLowerCase();
    if (category === 'all') return true;
    if (kind === 'consultation') return category === 'visit' || category === 'prescription';
    return kind.includes(category);
  });
  return (
    <Screen title="Medical records" tab="Records" light>
      <Segments values={['all', 'prescription', 'report', 'visit']} selected={category} onChange={setCategory} />
      <DataState resource={r} />
      <Notice text={a.error} />
      {records.map(row => (
        <Tile
          key={row.id}
          title={row.title ?? 'Medical record'}
          leading={<FileText color="#07598e" size={23} />}
          subtitle={`${row.kind ?? ''} · ${row.record_date ?? ''}`}
          onPress={() => {
            p.setRecord(row);
            nav.navigate('Prescription');
          }}
        />
      ))}
      {r.data && !records.length && (
        <Text style={styles.muted}>No released records yet.</Text>
      )}
      <SettingRow title="Upload a personal record" icon={FileText} onPress={() => setShowUpload(!showUpload)} />
      {showUpload && <View style={styles.formCard}>
      <Text style={styles.sectionTitle}>Upload a personal record</Text>
      <Text style={styles.tileSubtitle}>Choose a PDF or image from your device.</Text>
      <Field
        label="Document title"
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
            setShowUpload(false);
            r.reload();
          })
        }
      />
      </View>}
    </Screen>
  );
}
function Prescription() {
  const p = usePatient(),
    a = useAction(),
    row = p.record;
  const details = useResource<{
    data: Record<string, unknown>;
    doctor_name: string;
  }>(
    row?.kind === 'consultation' && typeof row.source_id === 'string'
      ? '/prescriptions/' + row.source_id
      : null,
  );
  return (
    <Screen title={row?.kind === 'consultation' ? 'Prescription details' : 'Medical document'} light>
      {row && <Tile title={row.title ?? 'Visit summary'} subtitle={details.data?.doctor_name ?? asText(row.record_date)} leading={<FileText color="#07598e" size={26} />} />}
      <DataState resource={details} />
      {details.data && (
        <Details
          value={{
            ...details.data.data,
            doctor_name: details.data.doctor_name,
          }}
        />
      )}
      <Notice text={a.error} />
      {row ? (
        <>
          {row.kind !== 'uploaded' && <Details value={{ ...row, title: undefined, record_date: undefined }} />}
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
    [tests, setTests] = useState<string[]>([]),
    [section, setSection] = useState('tests');
  const orders = list(r.data).filter(row => section === 'tests' || Boolean(row.report));
  return (
    <Screen title="Lab tests & reports" light>
      <Segments values={['tests', 'reports']} selected={section} onChange={setSection} />
      <DataState resource={r} />
      <Notice text={a.error} />
      {orders.map(row => (
        <View key={row.id}>
          <Tile title={row.name ?? row.title ?? 'Lab order'} subtitle={asText(row.status)} />
          {Boolean(row.report) && typeof row.report === 'object' && (
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
      {r.data && !orders.length && (
        <Text style={styles.muted}>{section === 'tests' ? 'No lab orders yet.' : 'No released reports yet.'}</Text>
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
    [filter, setFilter] = useState('all'),
    payments = useResource<{ data: Item[] }>(
      '/payments' + query({ patient_id: p.profile?.id }),
    );
  const invoices = list(r.data).filter(row => {
    const status = asText(row.payment_status ?? row.status).toLowerCase();
    return filter === 'all' || (filter === 'paid' ? status === 'paid' : ['pending', 'unpaid', 'partial', 'partially paid', 'overdue'].includes(status));
  });
  return (
    <Screen title="Payments & invoices" light>
      <Segments values={['all', 'paid', 'pending']} selected={filter} onChange={setFilter} />
      <DataState resource={r} />
      <Notice text={a.error} />
      {invoices.map(row => (
        <View key={row.id} style={styles.formCard}>
          <View style={styles.tileRow}>
            <Receipt color="#07598e" size={24} />
            <View style={styles.tileBody}>
              <Text style={styles.cardTitle}>{asText(row.record_number) || 'Clinic invoice'}</Text>
              <Text style={styles.tileSubtitle}>{asText(row.record_date)}</Text>
            </View>
            <View style={styles.invoiceAmount}>
              <Text style={styles.cardTitle}>₹{Number(row.total ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text>
              <Text style={styles.statusChip}>{asText(row.payment_status ?? row.status) || 'Unknown'}</Text>
            </View>
          </View>
          <Button
            secondary
            title="Download invoice PDF"
            icon={FileText}
            disabled={a.busy}
            onPress={() =>
              void a.run(() =>
                downloadDocument('/invoices/' + row.id + '/download'),
              )
            }
          />
        </View>
      ))}
      {r.data && !invoices.length && <Tile title="No invoices in this view" />}
      <Text style={styles.sectionTitle}>Online payment history</Text>
      <DataState resource={payments} />
      {payments.data && !list(payments.data).length && <Tile title="No online payments yet" />}
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
          leading={<Text style={styles.shortcutIcon}>●</Text>}
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
    [success, setSuccess] = useState(''),
    [panel, setPanel] = useState<'link' | 'support' | null>(null);
  return (
    <Screen title="Account" tab="Account" light>
      <Tile title={p.me?.profile.name ?? 'My account'} subtitle={p.me?.phone} leading={<Avatar size={54} />} />
      <Notice text={a.error} />
      {success && <Text style={styles.muted}>{success}</Text>}
      <View style={styles.settingsGroup}>
        <SettingRow title="My profile" icon={UserRound} onPress={() => nav.navigate('Profile')} />
        <SettingRow title="Family members" icon={Users} onPress={() => nav.navigate('Family')} />
        <SettingRow title="Notifications" icon={Bell} onPress={() => nav.navigate('Notifications')} />
        <SettingRow title="Payments & invoices" icon={Receipt} onPress={() => nav.navigate('Invoices')} />
        <SettingRow title="Link a clinic record" icon={FileText} onPress={() => setPanel(panel === 'link' ? null : 'link')} />
        <SettingRow title="Help & support" icon={CircleHelp} onPress={() => setPanel(panel === 'support' ? null : 'support')} />
      </View>
      {panel === 'link' && <View style={styles.formCard}>
      <Text style={styles.sectionTitle}>Link an existing clinic record</Text>
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
      </View>}
      {panel === 'support' && <View style={styles.formCard}>
      <Text style={styles.sectionTitle}>Contact clinic support</Text>
      {!p.clinic && <Tile title="Choose a clinic" onPress={() => nav.navigate('Clinics')} />}
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
      </View>}
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
    </Screen>
  );
}
const components: Record<ScreenName, React.ComponentType> = {
  Welcome: PatientAuth,
  OTP: PatientAuth,
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
  TurnAlert: () => <Queue alert />,
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
) as unknown as Record<ScreenName, React.ComponentType>;
const styles = StyleSheet.create({
  settingsGroup: { backgroundColor: '#fff', borderRadius: 15, borderWidth: 1, borderColor: '#e1ebf4', overflow: 'hidden' },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e1ebf4' },
  formCard: { backgroundColor: '#fff', padding: 14, borderRadius: 15, gap: 10 },
  timeSlot: { width: '30%', minHeight: 44, justifyContent: 'center', borderRadius: 10, borderColor: '#c8dcec', borderWidth: 1, backgroundColor: '#fff' },
  statusChip: { color: '#07598e', backgroundColor: '#e8f3ff', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, fontSize: 11, fontWeight: '700', maxWidth: 94 },
  invoiceAmount: { alignItems: 'flex-end', gap: 5 },
  tileRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  tileBody: { flex: 1 },
  tileSubtitle: { color: '#526b83', fontSize: 13, lineHeight: 19, marginTop: 3 },
  chevron: { color: '#07598e', fontWeight: '700', fontSize: 16 },
  segments: { flexDirection: 'row', padding: 4, gap: 4, backgroundColor: '#e7eff8', borderRadius: 18, marginVertical: 8 },
  segment: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 15 },
  activeSegment: { backgroundColor: '#07598e' },
  segmentText: { color: '#143953', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  activeSegmentText: { color: '#fff' },
  hero: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: '#07598e', padding: 16, borderRadius: 18 },
  heroTitle: { color: '#fff', flexShrink: 1, fontWeight: '800', fontSize: 24 },
  shortcuts: { flexDirection: 'row', gap: 6, marginVertical: 14 },
  shortcut: { flex: 1, borderRadius: 12, paddingVertical: 10, gap: 5, backgroundColor: '#e8f3ff', alignItems: 'center' },
  shortcutIcon: { color: '#07598e', fontSize: 23, fontWeight: '800', marginBottom: 4 },
  sectionTitle: { color: '#102b45', fontSize: 17, fontWeight: '800', marginTop: 8, marginBottom: 5 },
  clinicThumb: { borderRadius: 10, overflow: 'hidden' },
  clinicBanner: { borderRadius: 16, overflow: 'hidden' },
  doctorHero: { backgroundColor: '#e8f3ff', borderRadius: 18, alignItems: 'center', padding: 20 },
  queueToken: { alignItems: 'center', borderRadius: 16, backgroundColor: '#edf7ff', padding: 14 },
  tokenNumber: { fontSize: 30, fontWeight: '800', color: '#07598e' },
  confirmIcon: { color: '#087962', fontSize: 44, fontWeight: '800' },
  queueStats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, padding: 12, borderRadius: 12, backgroundColor: '#e8f3ff', alignItems: 'center' },
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d8e8f4',
    borderRadius: 14,
    padding: 13,
    marginVertical: 2,
    shadowColor: '#174c76',
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  cardPressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#12334f' },
  muted: { color: '#567189', lineHeight: 23, marginVertical: 12 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#567189',
    textTransform: 'capitalize',
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e1ebf4',
    paddingVertical: 8,
  },
  detailLabel: { width: '36%', color: '#526b83', fontSize: 13, lineHeight: 19, textTransform: 'capitalize' },
  detailValue: { flex: 1, color: '#12334f', fontSize: 14, lineHeight: 20 },
  error: {
    color: '#a32135',
    backgroundColor: '#fff0f1',
    padding: 14,
    borderRadius: 12,
    marginVertical: 10,
  },
  menu: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 14 },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f9ff',
  },
});
