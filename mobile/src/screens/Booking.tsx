import React, { useState } from 'react';
import { Alert, Pressable, Share, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  CalendarDays,
  Check,
  ChevronDown,
  Download,
  FileText,
  Share2,
  Upload,
  UserRound,
  X,
} from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import { Avatar } from '../components/Illustrations';
import { Button, Radio, Screen } from '../components/ui';
import { DoctorMini } from './Discovery';
import { useDemo } from '../data/DemoContext';
import { colors, s } from '../theme';
import type { Navigation } from '../navigation';
export function BookingSummary() {
  const { patient, day, time } = useDemo();
  return (
    <View style={{ gap: 12 }}>
      <DoctorMini />
      <View style={s.row}>
        <CalendarDays size={18} color={colors.blue} />
        <Text style={s.text}>
          Wed, {day} Nov 2026 · {time}
        </Text>
      </View>
      <View style={s.row}>
        <UserRound size={18} color={colors.blue} />
        <Text style={[s.text, s.grow]}>Patient: {patient}</Text>
      </View>
    </View>
  );
}
export function SelectAppointment() {
  const nav = useNavigation<Navigation>();
  const { family, name, patient, setPatient, day, setDay, time, setTime } =
    useDemo();
  const [patientsOpen, setPatientsOpen] = useState(false);
  const [visit, setVisit] = useState('OPD Consultation');
  return (
    <Screen
      title="Select Appointment"
      footer={
        <Button title="Continue" onPress={() => nav.navigate('VisitDetails')} />
      }
    >
      <Text style={s.label}>Patient</Text>
      <Pressable
        onPress={() => setPatientsOpen(!patientsOpen)}
        style={[s.input, s.between]}
      >
        <View style={[s.row, s.grow]}>
          <Avatar size={28} />
          <Text style={[s.bold, s.grow]}>{patient}</Text>
        </View>
        <ChevronDown size={18} color={colors.navy} />
      </Pressable>
      {patientsOpen && (
        <View style={s.card}>
          {family.map((member, i) => {
            const label = i === 0 ? name : member.name;
            return (
              <Pressable
                key={member.name}
                onPress={() => {
                  setPatient(label);
                  setPatientsOpen(false);
                }}
                style={{ paddingVertical: 9 }}
              >
                <Text style={s.text}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <Text style={s.label}>Visit Type</Text>
      <Pressable
        onPress={() =>
          setVisit(
            visit === 'OPD Consultation'
              ? 'Follow-up Consultation'
              : 'OPD Consultation',
          )
        }
        style={[s.input, s.between]}
      >
        <Text style={s.bold}>{visit}</Text>
        <ChevronDown size={18} color={colors.navy} />
      </Pressable>
      <Text style={s.label}>Select Date</Text>
      <View style={[s.row, { gap: 8 }]}>
        {[
          ['Mon', '11'],
          ['Tue', '12'],
          ['Wed', '13'],
          ['Thu', '14'],
          ['Fri', '15'],
        ].map(([weekday, date]) => (
          <Pressable
            key={date}
            accessibilityLabel={`${weekday} ${date} November`}
            onPress={() => setDay(date)}
            style={{
              flex: 1,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: day === date ? colors.blue : colors.line,
              backgroundColor: day === date ? colors.blue : '#fff',
              paddingVertical: 11,
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                color: day === date ? '#fff' : colors.navy,
              }}
            >
              {weekday}
            </Text>
            <Text
              style={{
                fontSize: 18,
                fontWeight: '800',
                color: day === date ? '#fff' : colors.navy,
              }}
            >
              {date}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.label}>Select Time Slot</Text>
      <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
        {[
          '10:00 AM',
          '10:30 AM',
          '11:00 AM',
          '11:30 AM',
          '12:00 PM',
          '12:30 PM',
        ].map(slot => (
          <Pressable
            key={slot}
            onPress={() => setTime(slot)}
            style={{
              width: '31%',
              paddingVertical: 12,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: time === slot ? colors.blue : '#fff',
            }}
          >
            <Text
              style={{
                textAlign: 'center',
                fontWeight: '700',
                fontSize: 13,
                color: time === slot ? '#fff' : colors.navy,
              }}
            >
              {slot}
            </Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
export function VisitDetails() {
  const nav = useNavigation<Navigation>();
  const { visitType, setVisitType } = useDemo();
  const [reason, setReason] = useState('Chest pain and shortness of breath');
  const [symptoms, setSymptoms] = useState(['Chest pain', 'Breathlessness']);
  const [report, setReport] = useState(true);
  return (
    <Screen
      title="Visit Details"
      footer={
        <Button
          title="Continue"
          disabled={!reason.trim()}
          onPress={() => nav.navigate('Payment')}
        />
      }
    >
      <Text style={s.label}>Reason for Visit *</Text>
      <TextInput
        accessibilityLabel="Reason for visit"
        value={reason}
        onChangeText={setReason}
        multiline
        style={[s.input, { minHeight: 76, textAlignVertical: 'top' }]}
      />
      <Text style={s.label}>Symptoms (optional)</Text>
      <View style={[s.row, { flexWrap: 'wrap' }]}>
        {symptoms.map(symptom => (
          <Pressable
            key={symptom}
            onPress={() =>
              setSymptoms(symptoms.filter(item => item !== symptom))
            }
            style={[
              s.row,
              {
                gap: 5,
                backgroundColor: '#dee7ff',
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderRadius: 16,
              },
            ]}
          >
            <Text style={s.link}>{symptom}</Text>
            <X size={14} color={colors.blue} />
          </Pressable>
        ))}
      </View>
      <Text style={s.label}>Visit Type</Text>
      <View style={s.row}>
        {['New Visit', 'Follow-up'].map(type => (
          <Radio
            key={type}
            label={type}
            selected={visitType === type}
            onPress={() => setVisitType(type)}
          />
        ))}
      </View>
      <Text style={s.label}>Upload Reports (optional)</Text>
      {report ? (
        <View style={[s.card, s.row]}>
          <FileText size={28} color={colors.bright} />
          <View style={s.grow}>
            <Text style={s.bold}>ECG_Report.pdf</Text>
            <Text style={s.small}>1.2 MB</Text>
          </View>
          <Pressable
            accessibilityLabel="Remove ECG report"
            onPress={() => setReport(false)}
          >
            <X size={22} color={colors.red} />
          </Pressable>
        </View>
      ) : (
        <Button
          secondary
          title="Attach sample report"
          icon={Upload}
          onPress={() => {
            setReport(true);
            Alert.alert(
              'Demo attachment',
              'A sample report has been added locally. File uploads will be connected later.',
            );
          }}
        />
      )}
    </Screen>
  );
}
export function Payment() {
  const nav = useNavigation<Navigation>();
  const { doctor, setBooked } = useDemo();
  const [method, setMethod] = useState('UPI');
  return (
    <Screen
      title="Review & Payment"
      footer={
        <Button
          title={`Pay ₹${doctor.fee + 20}`}
          onPress={() =>
            Alert.alert(
              'Demo payment',
              `Simulate a successful ₹${
                doctor.fee + 20
              } payment? No money will be charged.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Confirm demo booking',
                  onPress: () => {
                    setBooked(true);
                    nav.navigate('Confirmation');
                  },
                },
              ],
            )
          }
        />
      }
    >
      <Text style={s.heading}>Booking Summary</Text>
      <View style={s.card}>
        <BookingSummary />
        <View style={s.divider} />
        <View style={s.between}>
          <Text style={s.text}>Consultation Fee</Text>
          <Text style={s.bold}>₹{doctor.fee}</Text>
        </View>
        <View style={s.between}>
          <Text style={s.text}>Platform Fee</Text>
          <Text style={s.bold}>₹20</Text>
        </View>
        <View
          style={[
            s.between,
            { padding: 12, backgroundColor: colors.pale, borderRadius: 8 },
          ]}
        >
          <Text style={s.bold}>Total Payable</Text>
          <Text style={[s.bold, { fontSize: 19 }]}>₹{doctor.fee + 20}</Text>
        </View>
      </View>
      <Text style={s.heading}>Payment Method</Text>
      <Radio
        label="UPI (GPay, PhonePe, Paytm)"
        selected={method === 'UPI'}
        onPress={() => setMethod('UPI')}
      />
      <Radio
        label="Debit / Credit Card"
        selected={method === 'Card'}
        onPress={() => setMethod('Card')}
      />
    </Screen>
  );
}
export const sharePass = () =>
  Share.share({
    message:
      'JibonCare Appointment Pass\nJC-AP-10456 · Token A-104\nMediCity Multispeciality Hospital\nStatic demo appointment',
  }).catch(() => {});
export function Confirmation() {
  const nav = useNavigation<Navigation>();
  const { day, time, doctor, clinic } = useDemo();
  return (
    <Screen
      title="Booking Confirmation"
      footer={
        <Button title="Back to Home" onPress={() => nav.navigate('Home')} />
      }
    >
      <View style={{ alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <View
          style={{
            width: 73,
            height: 73,
            borderRadius: 40,
            backgroundColor: '#008b7f',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Check color="#fff" size={45} strokeWidth={4} />
        </View>
        <Text style={[s.title, { color: '#006b59' }]}>
          Appointment Confirmed!
        </Text>
        <View
          style={{
            backgroundColor: colors.pale,
            paddingHorizontal: 28,
            paddingVertical: 12,
            borderRadius: 10,
            alignItems: 'center',
          }}
        >
          <Text style={s.small}>Appointment ID</Text>
          <Text style={[s.bold, { fontSize: 21 }]}>JC-AP-10456</Text>
        </View>
      </View>
      <View style={s.card}>
        <DoctorMini />
        <View style={s.row}>
          <CalendarDays size={18} color={colors.blue} />
          <Text style={s.text}>
            Wed, {day} Nov 2026 · {time}
          </Text>
        </View>
        <Text style={s.text}>{clinic.name}</Text>
        <View style={s.between}>
          <Text style={[s.bold, { fontSize: 18 }]}>Token: A-104</Text>
          <QRCode
            value="jiboncare:demo:appointment:JC-AP-10456"
            size={82}
            color={colors.navy}
          />
        </View>
      </View>
      <View style={[s.row, { justifyContent: 'space-around', marginTop: 10 }]}>
        {[
          ['Add to Calendar', CalendarDays],
          ['Share', Share2],
          ['Download', Download],
        ].map(([label, Icon]) => {
          const ActionIcon = Icon as typeof CalendarDays;
          return (
            <Pressable
              key={String(label)}
              style={{ alignItems: 'center', gap: 8 }}
              onPress={() =>
                label === 'Share'
                  ? sharePass()
                  : Alert.alert(
                      String(label),
                      label === 'Download'
                        ? 'The pass is displayed above. PDF export will be connected in the dynamic phase.'
                        : `${doctor.name}\nNovember ${day}, 2026 · ${time}\nCalendar integration will be connected later.`,
                    )
              }
            >
              <ActionIcon size={24} color={colors.blue} />
              <Text style={[s.small, { fontSize: 11 }]}>{String(label)}</Text>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
