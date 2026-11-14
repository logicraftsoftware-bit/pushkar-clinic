import React, { useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  Bell,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Download,
  FileText,
  Globe,
  LogOut,
  Plus,
  Share2,
  ShieldCheck,
  UserRound,
  UsersRound,
  Waves,
} from 'lucide-react-native';
import { Avatar } from '../components/Illustrations';
import { Badge, Button, Chips, Row, Screen } from '../components/ui';
import { DoctorMini } from './Discovery';
import { useDemo } from '../data/DemoContext';
import { colors, s } from '../theme';
import type { Navigation } from '../navigation';
const recordRows = [
  {
    date: '13 Nov 2026',
    description: 'OPD Visit · Dr. Arindam Sen',
    types: ['Prescription', 'Report'],
  },
  {
    date: '28 Oct 2026',
    description: 'Follow-up · Dr. Priyanka Roy',
    types: ['Prescription'],
  },
  {
    date: '15 Sep 2026',
    description: 'Lab Tests · Pathology',
    types: ['Reports'],
  },
];
export function Records() {
  const nav = useNavigation<Navigation>();
  const [filter, setFilter] = useState('All');
  const rows = recordRows.filter(
    row =>
      filter === 'All' ||
      filter === 'Visits' ||
      (filter === 'Prescriptions'
        ? row.types.includes('Prescription')
        : row.types.some(type => type.startsWith('Report'))),
  );
  return (
    <Screen title="Medical Records" tab="Records">
      <Chips
        items={['All', 'Prescriptions', 'Reports', 'Visits']}
        selected={filter}
        onSelect={setFilter}
      />
      {rows.map(row => (
        <Pressable
          key={row.date}
          onPress={() =>
            nav.navigate(
              row.types.includes('Prescription')
                ? 'Prescription'
                : 'LabReports',
            )
          }
          style={s.card}
        >
          <View style={s.between}>
            <View style={s.grow}>
              <Text style={s.bold}>{row.date}</Text>
              <Text style={[s.small, { marginTop: 4, color: colors.navy }]}>
                {row.description}
              </Text>
            </View>
            <ChevronRight size={19} color={colors.navy} />
          </View>
          <View style={s.row}>
            {row.types.map(type => (
              <Pressable
                key={type}
                onPress={() =>
                  nav.navigate(
                    type === 'Prescription' ? 'Prescription' : 'LabReports',
                  )
                }
              >
                <Badge text={`⊕  ${type}`} />
              </Pressable>
            ))}
          </View>
        </Pressable>
      ))}
    </Screen>
  );
}
export function Prescription() {
  const [tab, setTab] = useState('Prescription');
  return (
    <Screen
      title="Prescription Details"
      footer={
        <View style={s.row}>
          <View style={s.grow}>
            <Button
              secondary
              title="Download PDF"
              icon={Download}
              onPress={() =>
                Alert.alert(
                  'Static prescription',
                  'PDF export will be connected when the records API is added.',
                )
              }
            />
          </View>
          <View style={s.grow}>
            <Button
              secondary
              title="Share"
              icon={Share2}
              onPress={() =>
                Share.share({
                  message:
                    'JibonCare · Demo prescription\nDr. Arindam Sen · 13 Nov 2026\nSample design content only.',
                }).catch(() => {})
              }
            />
          </View>
        </View>
      }
    >
      <DoctorMini />
      <Text style={[s.small, { marginTop: 6 }]}>13 Nov 2026 · 11:30 AM</Text>
      <Chips
        items={['Prescription', 'Visit Summary']}
        selected={tab}
        onSelect={setTab}
      />
      {tab === 'Prescription' ? (
        <>
          <Text style={s.bold}>Rx</Text>
          {[
            [
              'Amlodipine 5 mg',
              '1 tablet – Once daily (After breakfast)',
              '30 days',
            ],
            ['Atorvastatin 10 mg', '1 tablet – At night', '30 days'],
            ['Pantoprazole 40 mg', '1 tablet – Before breakfast', '14 days'],
          ].map(([name, dose, duration]) => (
            <View
              key={name}
              style={{
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderColor: colors.line,
              }}
            >
              <View style={s.between}>
                <Text style={[s.bold, s.grow]}>{name}</Text>
                <Badge text={duration} />
              </View>
              <Text style={[s.small, { color: colors.navy }]}>{dose}</Text>
            </View>
          ))}
          <Text style={s.heading}>Instructions</Text>
          <Text style={s.text}>• Low salt diet, regular exercise</Text>
          <Text style={s.text}>• Follow up after 30 days</Text>
        </>
      ) : (
        <View style={s.card}>
          <Text style={s.heading}>Visit Summary</Text>
          <Text style={s.text}>Reason: Chest pain and breathlessness</Text>
          <Text style={s.text}>Blood Pressure: 130/80 mmHg</Text>
          <Text style={s.text}>
            Advice: Review investigations and follow up in 30 days.
          </Text>
          <Badge text="Follow-up: 13 Dec 2026" />
        </View>
      )}
      <Text style={[s.small, { marginTop: 18 }]}>
        Sample prescription content for screen design.
      </Text>
    </Screen>
  );
}
const tests = [
  { name: 'CBC (Complete Blood Count)', status: 'Report Ready' },
  { name: 'Lipid Profile', status: 'Report Ready' },
  { name: 'ECG', status: 'Completed' },
];
export function LabReports() {
  const [tab, setTab] = useState('Tests');
  const [booked, setBooked] = useState(false);
  return (
    <Screen
      title="Lab Tests & Reports"
      footer={
        <Button
          title={booked ? 'Lab Test Requested' : 'Book a Lab Test'}
          icon={Plus}
          onPress={() =>
            Alert.alert(
              'Book a Lab Test',
              'Add a sample CBC test booking to this demo?',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Confirm request', onPress: () => setBooked(true) },
              ],
            )
          }
        />
      }
    >
      <Chips items={['Tests', 'Reports']} selected={tab} onSelect={setTab} />
      {tests.map(test => (
        <View
          key={test.name}
          style={[
            s.between,
            {
              paddingVertical: 18,
              borderBottomWidth: 1,
              borderColor: colors.line,
            },
          ]}
        >
          <View style={s.grow}>
            <Text style={s.bold}>{test.name}</Text>
            <Text style={s.small}>Ordered: 13 Nov 2026</Text>
            <Text style={s.small}>
              Status:{' '}
              <Text style={{ color: colors.green, fontWeight: '700' }}>
                {test.status}
              </Text>
            </Text>
          </View>
          <Pressable
            accessibilityLabel={`View ${test.name}`}
            onPress={() =>
              Alert.alert(
                `${test.name} — Demo Report`,
                'Patient: Dwaipayan Bhattacharya\nCollected: 13 Nov 2026\nReport status: Released\n\nThe actual report viewer will use clinic documents in the dynamic phase.',
              )
            }
            style={{
              borderWidth: 1,
              borderColor: colors.blue,
              borderRadius: 6,
              paddingHorizontal: 10,
              paddingVertical: 6,
            }}
          >
            <Text style={s.link}>{tab === 'Reports' ? 'Report' : 'View'}</Text>
          </Pressable>
        </View>
      ))}
      {booked && (
        <View style={[s.card, { marginTop: 18 }]}>
          <Text style={s.bold}>CBC booking requested</Text>
          <Badge text="Pending clinic confirmation" tone="yellow" />
        </View>
      )}
    </Screen>
  );
}
const invoices = [
  {
    id: 'JC-INV-10456',
    amount: '720',
    date: '13 Nov 2026',
    type: 'Consultation',
    status: 'Paid',
  },
  {
    id: 'JC-INV-10398',
    amount: '700',
    date: '28 Oct 2026',
    type: 'Follow-up',
    status: 'Paid',
  },
  {
    id: 'JC-INV-10234',
    amount: '1,450',
    date: '15 Sep 2026',
    type: 'Lab Tests',
    status: 'Pending',
  },
];
export function Invoices() {
  const [filter, setFilter] = useState('All');
  return (
    <Screen title="Payments & Invoices">
      <Chips
        items={['All', 'Paid', 'Pending']}
        selected={filter}
        onSelect={setFilter}
      />
      {invoices
        .filter(item => filter === 'All' || item.status === filter)
        .map(item => (
          <View key={item.id} style={s.card}>
            <View style={s.between}>
              <Text style={s.bold}>{item.id}</Text>
              <Text style={[s.bold, { fontSize: 18 }]}>₹{item.amount}</Text>
            </View>
            <View style={s.between}>
              <View style={s.grow}>
                <Text style={s.small}>
                  {item.date} · {item.type}
                </Text>
              </View>
              <Badge
                text={item.status}
                tone={item.status === 'Paid' ? 'green' : 'yellow'}
              />
              <Pressable
                accessibilityLabel={`Download invoice ${item.id}`}
                onPress={() =>
                  Alert.alert(
                    item.id,
                    `Amount: ₹${item.amount}\nStatus: ${item.status}\n\nInvoice downloads will be connected to the backend later.`,
                  )
                }
              >
                <Download size={20} color={colors.navy} />
              </Pressable>
            </View>
          </View>
        ))}
    </Screen>
  );
}
const notifications = [
  {
    title: 'Appointment Confirmed',
    message:
      'Your appointment with Dr. Arindam Sen on 13 Nov, 11:30 AM is confirmed.',
    time: '2h ago',
    icon: CalendarCheck,
    route: 'AppointmentDetails',
  },
  {
    title: 'Queue Update',
    message: 'Your token A-104. Now serving A-098.',
    time: '5h ago',
    icon: Waves,
    route: 'Queue',
  },
  {
    title: 'Turn Alert',
    message: 'Your turn is approaching. Please proceed to Room 2.',
    time: '1d ago',
    icon: Bell,
    route: 'TurnAlert',
  },
  {
    title: 'Report Ready',
    message: 'Your Lipid Profile report is ready.',
    time: '1d ago',
    icon: FileText,
    route: 'LabReports',
  },
  {
    title: 'Payment Successful',
    message: '₹720 paid for appointment JC-AP-10456.',
    time: '2d ago',
    icon: CheckCircle2,
    route: 'Invoices',
  },
] as const;
export function Notifications() {
  const nav = useNavigation<Navigation>();
  const { read, setRead } = useDemo();
  return (
    <Screen
      title="Notifications"
      right={
        <Pressable
          accessibilityLabel="Mark all notifications read"
          onPress={() => setRead(true)}
        >
          <CheckCircle2 color="#fff" size={22} />
        </Pressable>
      }
    >
      {notifications.map(({ title, message, time, icon: Icon, route }, i) => (
        <Pressable
          key={title}
          onPress={() => {
            setRead(true);
            nav.navigate(route);
          }}
          style={[
            s.row,
            {
              alignItems: 'flex-start',
              paddingVertical: 17,
              borderBottomWidth: 1,
              borderColor: colors.line,
              opacity: read ? 0.8 : 1,
            },
          ]}
        >
          <View
            style={{
              backgroundColor: i === 4 ? '#daf8e5' : colors.pale,
              borderRadius: 25,
              padding: 10,
            }}
          >
            <Icon size={23} color={i === 4 ? colors.green : colors.blue} />
          </View>
          <View style={s.grow}>
            <View style={[s.between, { alignItems: 'flex-start' }]}>
              <Text style={[s.bold, s.grow]}>{title}</Text>
              <Text style={[s.small, { fontSize: 10 }]}>{time}</Text>
            </View>
            <Text style={[s.small, { color: colors.navy, marginTop: 4 }]}>
              {message}
            </Text>
          </View>
        </Pressable>
      ))}
    </Screen>
  );
}
export function Account() {
  const nav = useNavigation<Navigation>();
  const { name, phone } = useDemo();
  const [language, setLanguage] = useState('English');
  const [alerts, setAlerts] = useState(true);
  return (
    <Screen title="Account" tab="Account">
      <View style={[s.card, s.row]}>
        <Avatar size={59} />
        <View style={s.grow}>
          <Text style={s.bold}>{name}</Text>
          <Text style={s.small}>+91 {phone}</Text>
        </View>
      </View>
      <Row
        icon={UserRound}
        title="My Profile"
        onPress={() => nav.navigate('Profile')}
      />
      <Row
        icon={UsersRound}
        title="Family Members"
        onPress={() => nav.navigate('Family')}
      />
      <Row
        icon={Bell}
        title="Notification Preferences"
        value={alerts ? 'On' : 'Off'}
        onPress={() =>
          Alert.alert(
            'Notification Preferences',
            'Enable notifications in this demo?',
            [
              { text: 'Off', onPress: () => setAlerts(false) },
              { text: 'On', onPress: () => setAlerts(true) },
            ],
          )
        }
      />
      <Row
        icon={Globe}
        title="Language"
        value={language}
        onPress={() =>
          Alert.alert(
            'Language',
            'Choose your preferred language. Full translations will be added later.',
            ['English', 'বাংলা', 'हिन्दी'].map(text => ({
              text,
              onPress: () => setLanguage(text),
            })),
          )
        }
      />
      <Row
        icon={CreditCard}
        title="Payments & Invoices"
        onPress={() => nav.navigate('Invoices')}
      />
      <Row
        icon={CircleHelp}
        title="Help & Support"
        onPress={() =>
          Alert.alert(
            'Help & Support',
            'For appointment or queue assistance, contact the clinic reception.\n\nThis is an offline screen preview.',
          )
        }
      />
      <Row
        icon={ShieldCheck}
        title="Privacy & Terms"
        onPress={() =>
          Alert.alert(
            'Privacy & Terms',
            'This prototype uses fictional sample data stored only in memory. No OTP, payment, or health data is sent to a server. Final policies will be added before launch.',
          )
        }
      />
      <Row
        icon={LogOut}
        title="Logout"
        danger
        onPress={() =>
          Alert.alert('Logout', 'Return to the welcome screen?', [
            { text: 'Stay', style: 'cancel' },
            {
              text: 'Logout',
              onPress: () =>
                nav.reset({ index: 0, routes: [{ name: 'Welcome' }] }),
            },
          ])
        }
      />
    </Screen>
  );
}
