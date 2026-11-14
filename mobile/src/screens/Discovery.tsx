import React, { useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  Bell,
  CalendarCheck,
  ChevronRight,
  ClipboardList,
  FileText,
  FlaskConical,
  Heart,
  Hospital,
  MapPin,
  Phone,
  Pill,
  Share2,
  ShieldCheck,
  Star,
  Stethoscope,
  Ticket,
  UsersRound,
  Waves,
} from 'lucide-react-native';
import { Avatar, Brand, ClinicArt } from '../components/Illustrations';
import LinearGradient from 'react-native-linear-gradient';
import { HeaderArt } from '../components/HealthArtwork';
import {
  Badge,
  Button,
  Chips,
  Empty,
  Row,
  Screen,
  SearchBar,
} from '../components/ui';
import { clinics, doctors, useDemo } from '../data/DemoContext';
import { colors, s } from '../theme';
import type { Navigation, ScreenName } from '../navigation';
export function DoctorMini() {
  const { doctor } = useDemo();
  return (
    <View style={s.row}>
      <Avatar doctor size={53} female={doctor.female} />
      <View style={s.grow}>
        <Text style={s.bold}>{doctor.name}</Text>
        <Text style={s.small}>{doctor.specialty}</Text>
      </View>
    </View>
  );
}
function Rating({
  value,
  reviews,
}: {
  value: string;
  reviews: number | string;
}) {
  return (
    <View style={[s.row, { gap: 4 }]}>
      <Star size={16} color="#f4ba00" fill="#f4ba00" />
      <Text style={{ color: '#dca000', fontWeight: '700', fontSize: 13 }}>
        {value}
      </Text>
      <Text style={s.small}>({reviews} Reviews)</Text>
    </View>
  );
}
export function Home() {
  const nav = useNavigation<Navigation>();
  const { name, doctor, time, day, booked } = useDemo();
  const quick: [string, ScreenName, typeof CalendarCheck][] = [
    ['Book\nAppointment', 'Doctors', CalendarCheck],
    ['Live\nQueue', 'Queue', Waves],
    ['Reports', 'LabReports', ClipboardList],
    ['Prescriptions', 'Records', FileText],
  ];
  return (
    <Screen tab="Home">
      <LinearGradient colors={['#0297cd', '#00579f']} style={homeStyles.hero}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <HeaderArt home />
        </View>
        <View style={homeStyles.brand}>
          <Brand compact />
          <Text style={homeStyles.brandName}>JibonCare</Text>
        </View>
        <View style={s.between}>
          <View>
            <Text style={homeStyles.hello}>Hello,</Text>
            <Text style={homeStyles.name}>{name.split(' ')[0]} 👋</Text>
          </View>
          <Pressable
            accessibilityLabel="Open account"
            onPress={() => nav.navigate('Account')}
            style={homeStyles.avatar}
          >
            <Avatar size={56} />
          </Pressable>
        </View>
      </LinearGradient>
      <View style={homeStyles.shortcuts}>
        {quick.map(([label, route, Icon], i) => (
          <Pressable
            key={route}
            onPress={() => nav.navigate(route)}
            style={homeStyles.shortcut}
          >
            <LinearGradient
              colors={i === 3 ? ['#fff9ef', '#ffebce'] : ['#eefcff', '#c8edff']}
              style={homeStyles.tile}
            >
              <Icon
                size={29}
                strokeWidth={2.2}
                color={i === 3 ? '#ff8a2b' : '#0075b9'}
              />
            </LinearGradient>
            <Text style={homeStyles.shortcutLabel}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={homeStyles.heading}>Upcoming Appointment</Text>
      {booked ? (
        <Pressable
          onPress={() => nav.navigate('AppointmentDetails')}
          style={[s.card, homeStyles.appointment]}
        >
          <Avatar doctor female={doctor.female} size={58} />
          <View style={s.grow}>
            <Text style={homeStyles.doctorName}>{doctor.name}</Text>
            <Text style={homeStyles.subtitle}>{doctor.specialty}</Text>
            <Text style={homeStyles.date}>
              Wed, {day} Nov · {time}
            </Text>
          </View>
          <ChevronRight size={23} color={colors.navy} />
        </Pressable>
      ) : (
        <Empty text="No upcoming appointments. Find a doctor to book a visit." />
      )}
      <View style={s.between}>
        <Text style={homeStyles.heading}>Live Queue</Text>
        <Pressable
          accessibilityLabel="Open notifications"
          onPress={() => nav.navigate('Notifications')}
        >
          <Bell size={25} color={colors.blue} />
        </Pressable>
      </View>
      <Pressable
        onPress={() => nav.navigate('Queue')}
        style={[s.row, { gap: 10 }]}
      >
        <LinearGradient
          colors={['#e1f3ff', '#d3edff']}
          style={[homeStyles.queueCard, { flex: 1.35 }]}
        >
          <Ticket size={25} color="#0084c6" />
          <View style={s.grow}>
            <Text style={homeStyles.queueTitle}>Your Token: A-104</Text>
            <Text style={homeStyles.queueSubtitle}>Now Serving: A-098</Text>
          </View>
        </LinearGradient>
        <LinearGradient
          colors={['#dff9f3', '#c7f3ee']}
          style={homeStyles.queueCard}
        >
          <UsersRound size={25} color="#10b7a4" />
          <View style={s.grow}>
            <Text style={homeStyles.queueTitle}>6 Ahead</Text>
            <Text style={[homeStyles.queueSubtitle, { color: '#416d89' }]}>
              ~ 12 Min
            </Text>
          </View>
        </LinearGradient>
      </Pressable>
      <Pressable
        onPress={() => nav.navigate('Clinics')}
        style={[s.card, s.row, homeStyles.clinic]}
      >
        <MapPin size={34} color={colors.blue} fill="#d0efff" />
        <View style={s.grow}>
          <Text style={homeStyles.doctorName}>Find your clinic</Text>
          <Text style={homeStyles.subtitle}>Care close to you</Text>
        </View>
        <Hospital color={colors.blue} size={26} />
      </Pressable>
    </Screen>
  );
}
const homeStyles = StyleSheet.create({
  hero: {
    height: 156,
    marginHorizontal: -20,
    marginTop: -20,
    paddingHorizontal: 20,
    paddingTop: 16,
    marginBottom: 14,
  },
  brand: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 17,
  },
  brandName: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 26,
    letterSpacing: -0.8,
  },
  hello: { fontSize: 18, color: '#fff', fontWeight: '600', marginBottom: 3 },
  name: { fontSize: 27, color: '#fff', fontWeight: '800', letterSpacing: -0.7 },
  avatar: {
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: '#e5f6ff',
    overflow: 'hidden',
  },
  shortcuts: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 5,
    marginBottom: 17,
  },
  shortcut: { alignItems: 'center', flex: 1, gap: 7 },
  tile: {
    height: 58,
    width: 58,
    borderRadius: 19,
    borderWidth: 1.5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 5px 12px rgba(0, 135, 198, 0.06)',
  },
  shortcutLabel: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    color: colors.navy,
    lineHeight: 16,
    letterSpacing: -0.3,
  },
  heading: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: colors.navy,
    marginTop: 9,
    marginBottom: 12,
  },
  appointment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    minHeight: 83,
    marginBottom: 13,
  },
  doctorName: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.navy,
    letterSpacing: -0.35,
  },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 3 },
  date: { fontSize: 12, color: '#142b50', marginTop: 4 },
  queueCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 62,
    paddingHorizontal: 10,
    paddingVertical: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d0eefb',
  },
  queueTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.navy,
    letterSpacing: -0.3,
  },
  queueSubtitle: { fontSize: 11, color: '#006bab', marginTop: 4 },
  clinic: { marginTop: 20, minHeight: 66, padding: 14, marginBottom: 0 },
});
export function Clinics() {
  const nav = useNavigation<Navigation>();
  const { setClinicIndex } = useDemo();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('All');
  const filtered = clinics.filter(
    item =>
      item.name.toLowerCase().includes(query.toLowerCase()) &&
      (type === 'All' || item.type === type),
  );
  return (
    <Screen title="Find Clinics">
      <SearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search clinic or location..."
      />
      <Chips
        items={['All', 'Hospital', 'Clinic', 'Diagnostic']}
        selected={type}
        onSelect={setType}
      />
      {filtered.map(item => (
        <Pressable
          key={item.name}
          onPress={() => {
            setClinicIndex(clinics.indexOf(item));
            nav.navigate('ClinicDetails');
          }}
          style={[
            s.row,
            {
              paddingVertical: 13,
              borderBottomWidth: 1,
              borderColor: colors.line,
              alignItems: 'flex-start',
            },
          ]}
        >
          <View style={{ borderRadius: 13, overflow: 'hidden' }}>
            <ClinicArt width={94} height={96} />
          </View>
          <View style={[s.grow, { gap: 4 }]}>
            <Text style={s.bold}>{item.name}</Text>
            <View style={[s.row, { gap: 4 }]}>
              <Star size={14} fill="#f4ba00" color="#f4ba00" />
              <Text style={s.small}>
                {item.rating} ({item.reviews}) · {item.distance} km
              </Text>
            </View>
            <Text style={[s.small, { color: colors.green, fontSize: 11 }]}>
              ● Open · {item.hours}
            </Text>
          </View>
        </Pressable>
      ))}
      {!filtered.length && <Empty text="No clinics match your search." />}
    </Screen>
  );
}
export function ClinicDetails() {
  const nav = useNavigation<Navigation>();
  const { clinic } = useDemo();
  const [tab, setTab] = useState('About');
  const [saved, setSaved] = useState(false);
  const facilities = [
    ['OPD', Stethoscope],
    ['IPD', Hospital],
    ['Emergency', ShieldCheck],
    ['Lab', FlaskConical],
    ['Pharmacy', Pill],
  ] as const;
  return (
    <Screen
      title="Clinic Details"
      right={
        <Pressable
          accessibilityLabel="Save clinic"
          onPress={() => setSaved(!saved)}
        >
          <Heart size={23} color="#fff" fill={saved ? '#fff' : 'transparent'} />
        </Pressable>
      }
      footer={
        <Button
          title="View Doctors & Book"
          onPress={() => nav.navigate('Doctors')}
        />
      }
    >
      <View style={{ margin: -20, marginBottom: 16 }}>
        <ClinicArt width="100%" height={190} />
      </View>
      <Text style={[s.title, { fontSize: 24 }]}>{clinic.name}</Text>
      <View style={{ marginTop: 10, gap: 8 }}>
        <Rating value={clinic.rating} reviews={clinic.reviews} />
        <Text style={[s.small, { color: colors.green }]}>
          ● Open · {clinic.hours}
        </Text>
      </View>
      <View
        style={[s.row, { justifyContent: 'space-around', marginVertical: 19 }]}
      >
        {[
          ['Call', Phone],
          ['Direction', MapPin],
          ['Share', Share2],
        ].map(([label, Icon]) => {
          const ActionIcon = Icon as typeof Phone;
          return (
            <Pressable
              key={String(label)}
              style={{ alignItems: 'center', gap: 7 }}
              onPress={() => {
                if (label === 'Share') {
                  Share.share({
                    message: `${clinic.name}\nMain Road, Jhargram – 721507`,
                  }).catch(() => {});
                } else if (label === 'Direction') {
                  Linking.openURL(
                    'https://www.google.com/maps/search/?api=1&query=Jhargram',
                  ).catch(() =>
                    Alert.alert('Directions', 'Main Road, Jhargram – 721507'),
                  );
                } else {
                  Alert.alert(
                    'Clinic contact',
                    'A real clinic phone number will be provided with the API.',
                  );
                }
              }}
            >
              <View
                style={{
                  backgroundColor: colors.pale,
                  padding: 10,
                  borderRadius: 24,
                }}
              >
                <ActionIcon size={23} color={colors.blue} />
              </View>
              <Text style={s.small}>{String(label)}</Text>
            </Pressable>
          );
        })}
      </View>
      <Chips
        items={['About', 'Doctors', 'Services']}
        selected={tab}
        onSelect={setTab}
      />
      {tab === 'About' && (
        <>
          <Text style={s.text}>
            A comprehensive multispeciality hospital with advanced facilities
            and expert doctors.
          </Text>
          <Row icon={MapPin} title="Main Road, Jhargram – 721507" />
          <Text style={s.heading}>Facilities</Text>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            {facilities.map(([label, Icon]) => (
              <View key={label} style={{ alignItems: 'center', gap: 6 }}>
                <Icon size={22} color={colors.blue} />
                <Text style={{ fontSize: 10, color: colors.navy }}>
                  {label}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
      {tab === 'Doctors' &&
        doctors.map(doctor => (
          <Row
            key={doctor.name}
            icon={Stethoscope}
            title={doctor.name}
            value={doctor.specialty}
            onPress={() => nav.navigate('Doctors')}
          />
        ))}
      {tab === 'Services' &&
        [
          'OPD Consultation',
          'Laboratory & Diagnostics',
          'Emergency Care',
          'Pharmacy',
        ].map(service => (
          <Row key={service} title={service} icon={ShieldCheck} />
        ))}
    </Screen>
  );
}
export function Doctors() {
  const nav = useNavigation<Navigation>();
  const { setDoctorIndex } = useDemo();
  const [query, setQuery] = useState('');
  const [specialty, setSpecialty] = useState('All');
  const filtered = doctors.filter(
    item =>
      `${item.name} ${item.specialty}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (specialty === 'All' ||
        (specialty === 'Medicine'
          ? item.specialty === 'General Physician'
          : item.specialty === specialty)),
  );
  return (
    <Screen title="Find Doctor">
      <SearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search by name or specialty..."
      />
      <Chips
        items={['All', 'Cardiology', 'Medicine', 'Eye']}
        selected={specialty}
        onSelect={setSpecialty}
      />
      {filtered.map(doctor => (
        <Pressable
          key={doctor.name}
          onPress={() => {
            setDoctorIndex(doctors.indexOf(doctor));
            nav.navigate('DoctorProfile');
          }}
          style={[
            s.row,
            {
              paddingVertical: 18,
              borderBottomWidth: 1,
              borderColor: colors.line,
              alignItems: 'flex-start',
            },
          ]}
        >
          <Avatar doctor female={doctor.female} size={68} />
          <View style={[s.grow, { gap: 4 }]}>
            <Text style={s.bold}>{doctor.name}</Text>
            <Text style={s.small}>{doctor.specialty}</Text>
            <View style={s.between}>
              <View style={[s.row, { gap: 3 }]}>
                <Star size={14} fill="#f4ba00" color="#f4ba00" />
                <Text style={s.small}>
                  {doctor.rating} ({doctor.reviews})
                </Text>
              </View>
              <Text style={s.bold}>₹{doctor.fee}</Text>
            </View>
            <Text style={[s.small, { color: colors.navy }]}>
              Next: Today, {doctor.next}
            </Text>
          </View>
        </Pressable>
      ))}
      {!filtered.length && <Empty text="No doctors match your filters." />}
    </Screen>
  );
}
export function DoctorProfile() {
  const nav = useNavigation<Navigation>();
  const { doctor } = useDemo();
  const [tab, setTab] = useState('About');
  const [saved, setSaved] = useState(false);
  return (
    <Screen
      title="Doctor Profile"
      right={
        <Pressable
          accessibilityLabel="Save doctor"
          onPress={() => setSaved(!saved)}
        >
          <Heart size={22} color="#fff" fill={saved ? '#fff' : 'transparent'} />
        </Pressable>
      }
      footer={
        <Button
          title="Book Appointment"
          onPress={() => nav.navigate('SelectAppointment')}
        />
      }
    >
      <View style={{ alignItems: 'center', gap: 7 }}>
        <Avatar doctor female={doctor.female} size={112} />
        <Text style={[s.title, { fontSize: 24 }]}>{doctor.name}</Text>
        <Text style={s.text}>{doctor.specialty}</Text>
        <Rating value={doctor.rating} reviews={doctor.reviews} />
        <View style={s.row}>
          <UsersRound size={17} color={colors.blue} />
          <Text style={s.text}>12+ Years Experience</Text>
        </View>
      </View>
      <Chips
        items={['About', 'Schedule', 'Reviews']}
        selected={tab}
        onSelect={setTab}
      />
      {tab === 'About' && (
        <>
          <Row icon={CalendarCheck} title="Qualifications" />
          <Text style={[s.small, { marginLeft: 31 }]}>
            MBBS, MD ({doctor.specialty})
          </Text>
          <Row icon={ClipboardList} title="Specialization" />
          <Text style={[s.small, { marginLeft: 31 }]}>
            {doctor.specialty === 'Cardiology'
              ? 'Heart Disease, Hypertension, Angioplasty'
              : doctor.specialty === 'Orthopedics'
              ? 'Joint Care, Bone Health, Sports Injuries'
              : 'General Medicine, Preventive Care'}
          </Text>
          <Row
            icon={Stethoscope}
            title="Consultation Fee"
            value={`₹${doctor.fee}`}
          />
        </>
      )}
      {tab === 'Schedule' && (
        <View style={s.card}>
          <Text style={s.bold}>MediCity Hospital</Text>
          <Text style={s.text}>Monday – Saturday</Text>
          <Text style={s.text}>10:00 AM – 2:00 PM</Text>
          <Badge text={`Next available: ${doctor.next}`} />
        </View>
      )}
      {tab === 'Reviews' &&
        [
          'Very attentive and helpful doctor.',
          'Clear advice and a comfortable visit.',
        ].map((review, i) => (
          <View key={review} style={s.card}>
            <Text style={s.bold}>{i === 0 ? 'Ananya S.' : 'Rahul D.'}</Text>
            <Rating value="5.0" reviews="Verified visit" />
            <Text style={s.text}>{review}</Text>
          </View>
        ))}
    </Screen>
  );
}
