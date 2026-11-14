import React, { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  BellRing,
  CheckCircle2,
  Download,
  Info,
  QrCode,
  Waves,
  XCircle,
} from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import LinearGradient from 'react-native-linear-gradient';
import { ClinicLandscape } from '../components/HealthArtwork';
import { Avatar } from '../components/Illustrations';
import { Badge, Button, Chips, Empty, Row, Screen } from '../components/ui';
import { DoctorMini } from './Discovery';
import { useDemo, doctors } from '../data/DemoContext';
import { colors, s } from '../theme';
import type { Navigation } from '../navigation';
export function Appointments() {
  const nav = useNavigation<Navigation>();
  const { doctor, day, time, booked, setBooked } = useDemo();
  const [filter, setFilter] = useState('Upcoming');
  function cancel() {
    Alert.alert('Cancel appointment?', 'This only updates the static demo.', [
      { text: 'Keep appointment', style: 'cancel' },
      {
        text: 'Cancel appointment',
        style: 'destructive',
        onPress: () => setBooked(false),
      },
    ]);
  }
  const rows =
    filter === 'Upcoming'
      ? booked
        ? [doctor, doctors[1]]
        : [doctors[1]]
      : filter === 'Cancelled'
      ? booked
        ? []
        : [doctor]
      : [doctors[0]];
  return (
    <Screen title="My Appointments" tab="Appointments">
      <Chips
        items={['Upcoming', 'Past', 'Cancelled']}
        selected={filter}
        onSelect={setFilter}
      />
      {rows.map((item, i) => (
        <View key={`${item.name}-${i}`} style={s.card}>
          <View style={s.row}>
            <Avatar doctor female={item.female} size={50} />
            <View style={s.grow}>
              <View style={[s.between, { alignItems: 'flex-start' }]}>
                <Text style={[s.bold, s.grow]}>{item.name}</Text>
                <Badge
                  text={
                    filter === 'Upcoming'
                      ? i === 0
                        ? 'Upcoming'
                        : 'Follow-up'
                      : filter === 'Past'
                      ? 'Completed'
                      : 'Cancelled'
                  }
                  tone={
                    filter === 'Cancelled' ? 'red' : i === 0 ? 'green' : 'blue'
                  }
                />
              </View>
              <Text style={s.small}>{item.specialty}</Text>
              <Text style={[s.small, { color: colors.navy, marginTop: 4 }]}>
                {i === 0
                  ? `Wed, ${day} Nov · ${time}`
                  : 'Thu, 28 Nov · 04:00 PM'}
              </Text>
              {i === 0 && <Text style={s.bold}>Token: A-104</Text>}
            </View>
          </View>
          <View
            style={[s.row, { justifyContent: 'space-between', marginTop: 5 }]}
          >
            <Pressable
              onPress={() =>
                nav.navigate(
                  filter === 'Past' ? 'Prescription' : 'AppointmentDetails',
                )
              }
            >
              <Badge text="View" />
            </Pressable>
            {filter === 'Upcoming' && (
              <>
                <Pressable onPress={() => nav.navigate('SelectAppointment')}>
                  <Badge text="Reschedule" />
                </Pressable>
                <Pressable onPress={cancel}>
                  <Badge text="Cancel" tone="red" />
                </Pressable>
              </>
            )}
          </View>
        </View>
      ))}
      {!rows.length && (
        <Empty text={`No ${filter.toLowerCase()} appointments.`} />
      )}
    </Screen>
  );
}
export function AppointmentDetails() {
  const nav = useNavigation<Navigation>();
  const { day, time, clinic, booked, setBooked, checkedIn } = useDemo();
  const details = [
    ['Appointment ID', 'JC-AP-10456'],
    ['Date & Time', `Wed, ${day} Nov · ${time}`],
    ['Clinic', clinic.name],
    ['Token', 'A-104'],
    ['Status', booked ? (checkedIn ? 'Checked in' : 'Confirmed') : 'Cancelled'],
  ];
  return (
    <Screen title="Appointment Details">
      <View style={{ alignItems: 'center', marginBottom: 20 }}>
        <Badge
          text={booked ? 'Upcoming' : 'Cancelled'}
          tone={booked ? 'blue' : 'red'}
        />
      </View>
      <View style={s.card}>
        <DoctorMini />
        {details.map(([label, value]) => (
          <View
            key={label}
            style={[
              s.between,
              {
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderColor: colors.line,
                alignItems: 'flex-start',
              },
            ]}
          >
            <Text style={[s.small, { color: colors.navy }]}>{label}</Text>
            <Text
              style={[s.bold, { fontSize: 12, textAlign: 'right', flex: 1 }]}
            >
              {value}
            </Text>
          </View>
        ))}
      </View>
      <Row
        icon={Waves}
        title="View Queue"
        onPress={() => nav.navigate('Queue')}
      />
      <Row
        icon={CheckCircle2}
        title="Check In / Mark Arrived"
        onPress={() => nav.navigate('CheckIn')}
      />
      <Row
        icon={Download}
        title="Download Appointment Pass"
        onPress={() => nav.navigate('Confirmation')}
      />
      <Row
        icon={XCircle}
        title="Reschedule / Cancel"
        onPress={() =>
          Alert.alert(
            'Manage appointment',
            'Choose an action for this demo booking.',
            [
              { text: 'Close', style: 'cancel' },
              {
                text: 'Reschedule',
                onPress: () => nav.navigate('SelectAppointment'),
              },
              {
                text: 'Cancel booking',
                style: 'destructive',
                onPress: () => setBooked(false),
              },
            ],
          )
        }
      />
    </Screen>
  );
}
export function CheckIn() {
  const nav = useNavigation<Navigation>();
  const { setCheckedIn, checkedIn, booked } = useDemo();
  function arrive() {
    if (!booked) {
      Alert.alert(
        'Appointment cancelled',
        'Book an appointment before checking in.',
      );
      return;
    }
    setCheckedIn(true);
    Alert.alert(
      'Check-in successful',
      'You have been added to the demo live queue.',
      [{ text: 'View Queue', onPress: () => nav.navigate('Queue') }],
    );
  }
  return (
    <Screen title="Patient Check-in">
      <View
        style={[s.card, { alignItems: 'center', paddingVertical: 28, gap: 15 }]}
      >
        <QRCode value="jiboncare:demo:clinic:medicity" size={118} />
        <Text style={[s.title, { fontSize: 25 }]}>
          {checkedIn ? 'You are Checked In' : 'Check-in at Clinic'}
        </Text>
        <Text style={[s.text, s.center]}>
          Scan the clinic QR code or{'\n'}confirm your arrival.
        </Text>
        <View style={{ width: '100%', marginTop: 10 }}>
          <Button
            title="Scan QR Code"
            icon={QrCode}
            onPress={() =>
              Alert.alert(
                'Static QR preview',
                'Camera scanning is not connected yet. Simulate scanning the clinic QR?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Simulate scan', onPress: arrive },
                ],
              )
            }
          />
        </View>
        <Text style={s.small}>or</Text>
        <View style={{ width: '100%' }}>
          <Button
            secondary
            title={checkedIn ? 'View Live Queue' : 'I Have Arrived'}
            onPress={checkedIn ? () => nav.navigate('Queue') : arrive}
          />
        </View>
        <Text style={s.small}>(Confirm Check-in)</Text>
      </View>
      <View style={[s.row, { alignItems: 'flex-start', padding: 12 }]}>
        <CheckCircle2 size={24} color={colors.green} />
        <Text style={[s.text, s.grow]}>
          Check-in allows the clinic to add you to the live queue.
        </Text>
      </View>
    </Screen>
  );
}
export function Queue() {
  const nav = useNavigation<Navigation>();
  const { booked } = useDemo();
  return (
    <Screen
      title="Live Queue"
      footer={
        __DEV__ ? (
          <Pressable onPress={() => nav.navigate('TurnAlert')}>
            <Text style={[s.link, s.center]}>Preview turn alert</Text>
          </Pressable>
        ) : undefined
      }
    >
      {booked ? (
        <>
          <DoctorMini />
          <View
            style={[
              s.card,
              { alignItems: 'center', paddingVertical: 22, marginTop: 20 },
            ]}
          >
            <Text style={s.text}>Your Token</Text>
            <Text style={s.token}>A-104</Text>
            <View style={[s.row, { marginTop: 12, alignSelf: 'stretch' }]}>
              <View style={s.metrics}>
                <Text style={s.small}>Now Serving</Text>
                <Text style={[s.title, s.blue]}>A-098</Text>
              </View>
              <View style={s.metrics}>
                <Text style={s.small}>Patients Ahead</Text>
                <Text style={s.title}>6</Text>
              </View>
            </View>
            <View style={[s.metrics, { alignSelf: 'stretch', marginTop: 4 }]}>
              <Text style={s.small}>Estimated Wait</Text>
              <Text style={[s.title, { fontSize: 24 }]}>~ 12 Minutes</Text>
            </View>
          </View>
          <Text style={[s.small, { color: colors.green }]}>
            ● Queue Status: Live · Last updated: 11:18 AM
          </Text>
          <View
            style={[s.card, s.row, { marginTop: 16, alignItems: 'flex-start' }]}
          >
            <Info color={colors.bright} size={21} />
            <Text style={[s.small, s.grow, { color: colors.navy }]}>
              Waiting times are an estimate and may change due to emergencies.
            </Text>
          </View>
        </>
      ) : (
        <Empty text="No active appointment. Book a consultation to join a queue." />
      )}
    </Screen>
  );
}
export function TurnAlert() {
  const [proceeded, setProceeded] = useState(false);
  return (
    <Screen title="Consultation" scroll={false} immersive>
      <LinearGradient
        colors={['#178ec8', '#03568f']}
        style={{
          flex: 1,
          margin: -20,
          padding: 25,
          alignItems: 'center',
          justifyContent: 'space-evenly',
        }}
      >
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 130,
            opacity: 0.25,
          }}
        >
          <ClinicLandscape />
        </View>
        <View style={{ alignItems: 'center', gap: 20 }}>
          <View
            style={{
              padding: 18,
              borderRadius: 60,
              backgroundColor: '#ffffff19',
            }}
          >
            <BellRing
              size={76}
              color="#ffcf40"
              fill="#ffc329"
              strokeWidth={1.5}
            />
          </View>
          <Text
            style={{
              color: '#fff',
              fontSize: 23,
              fontWeight: '800',
              textAlign: 'center',
            }}
          >
            {proceeded
              ? 'Please Meet Your Doctor'
              : 'Your Turn is Approaching!'}
          </Text>
        </View>
        <View
          style={{
            backgroundColor: '#eef5fd',
            borderRadius: 15,
            paddingVertical: 19,
            paddingHorizontal: 55,
            alignItems: 'center',
          }}
        >
          <Text style={s.text}>Token</Text>
          <Text style={s.token}>A-104</Text>
        </View>
        <Text
          style={{
            fontSize: 17,
            fontWeight: '700',
            color: '#fff',
            textAlign: 'center',
          }}
        >
          Please be ready.{'\n'}You will be called shortly.
        </Text>
        <View style={{ width: '100%' }}>
          <Button
            secondary
            title={
              proceeded
                ? 'Consultation Room 2'
                : 'Proceed to Consultation Room 2'
            }
            onPress={() => setProceeded(true)}
          />
        </View>
        <Pressable
          onPress={() =>
            Alert.alert(
              'Reception assistance',
              'Please approach the reception desk at the clinic.',
            )
          }
        >
          <Text style={{ color: '#fff', fontSize: 12 }}>
            Need Assistance? Contact Reception
          </Text>
        </Pressable>
      </LinearGradient>
    </Screen>
  );
}
