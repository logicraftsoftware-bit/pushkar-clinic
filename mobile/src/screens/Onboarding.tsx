import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowRight,
  Camera,
  ChevronRight,
  MoreVertical,
  Plus,
  X,
} from 'lucide-react-native';
import { Avatar, Brand } from '../components/Illustrations';
import { Button, Field, Radio, Screen } from '../components/ui';
import { useDemo } from '../data/DemoContext';
import { colors, s } from '../theme';
import type { Navigation } from '../navigation';
function BrandName() {
  return (
    <Text style={styles.brandName}>
      Jibon<Text style={{ color: colors.bright }}>Care</Text>
    </Text>
  );
}
export function Welcome() {
  const nav = useNavigation<Navigation>();
  const { phone, setPhone } = useDemo();
  const [login, setLogin] = useState(false);
  return (
    <Screen
      light
      scroll={false}
      footer={
        <Button
          title="Get Started"
          icon={ArrowRight}
          onPress={() => setLogin(true)}
        />
      }
    >
      <View
        style={[
          s.grow,
          { alignItems: 'center', justifyContent: 'space-evenly' },
        ]}
      >
        <View style={{ alignItems: 'center' }}>
          <Brand />
          <BrandName />
          <Text style={[s.bold, { fontSize: 20, marginTop: 3 }]}>
            জীবন সেবায়
          </Text>
          <Text style={[s.small, { color: colors.navy, marginTop: 10 }]}>
            Your Health Companion, Always.
          </Text>
        </View>
        <View style={styles.hero}>
          <View style={styles.heroBubble} />
          <View style={{ zIndex: 1 }}>
            <Avatar size={190} doctor />
          </View>
          <View style={styles.tablet}>
            <Text style={{ color: '#fff', fontSize: 30 }}>✚</Text>
          </View>
        </View>
        <Text style={[s.text, s.center, s.bold]}>
          Book Doctor, Track Queue{'\n'}Manage Prescriptions{'\n'}and Stay
          Healthy
        </Text>
        <View style={s.row}>
          {[0, 1, 2, 3].map(i => (
            <View
              key={i}
              style={{
                height: 7,
                width: 7,
                borderRadius: 4,
                backgroundColor: i === 0 ? colors.blue : '#9ac9e7',
              }}
            />
          ))}
        </View>
      </View>
      <Modal
        visible={login}
        transparent
        animationType="slide"
        onRequestClose={() => setLogin(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.overlay}
        >
          <View style={styles.loginSheet}>
            <View style={s.between}>
              <Text style={s.title}>Welcome to JibonCare</Text>
              <Pressable
                accessibilityLabel="Close login"
                onPress={() => setLogin(false)}
              >
                <X color={colors.blue} />
              </Pressable>
            </View>
            <Text style={[s.small, { marginTop: 8 }]}>
              Enter your mobile number to continue.
            </Text>
            <Field
              label="Mobile Number"
              keyboardType="phone-pad"
              maxLength={10}
              value={phone}
              onChangeText={setPhone}
            />
            <Text style={[s.small, { marginVertical: 14 }]}>
              Static preview: use OTP 528471. No SMS is sent.
            </Text>
            <Button
              title="Send OTP"
              disabled={!/^\d{10}$/.test(phone)}
              onPress={() => {
                setLogin(false);
                nav.navigate('OTP');
              }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
export function OTP() {
  const nav = useNavigation<Navigation>();
  const { phone } = useDemo();
  const [digits, setDigits] = useState(['5', '2', '8', '4', '7', '1']);
  const [seconds, setSeconds] = useState(28);
  const inputs = useRef<(React.ComponentRef<typeof TextInput> | null)[]>([]);
  useEffect(() => {
    if (!seconds) {
      return;
    }
    const timer = setTimeout(() => setSeconds(seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  return (
    <Screen light scroll={false}>
      <View style={[s.grow, { paddingTop: 30 }]}>
        <View style={[s.row, { justifyContent: 'center', marginBottom: 58 }]}>
          <Brand compact />
          <BrandName />
        </View>
        <Text style={[s.title, s.center]}>Verify Your Mobile Number</Text>
        <Text style={[s.text, s.center, { marginTop: 16 }]}>
          Enter the 6-digit OTP sent to{'\n'}
          <Text style={s.bold}>+91 {phone}</Text>
        </Text>
        <View
          style={[
            s.row,
            { justifyContent: 'space-between', marginTop: 28, gap: 7 },
          ]}
        >
          {digits.map((digit, i) => (
            <TextInput
              key={i}
              ref={ref => {
                inputs.current[i] = ref;
              }}
              accessibilityLabel={`OTP digit ${i + 1}`}
              value={digit}
              keyboardType="number-pad"
              maxLength={6}
              selectTextOnFocus
              style={styles.otp}
              onChangeText={value => {
                const clean = value.replace(/\D/g, '');
                if (clean.length > 1) {
                  setDigits(clean.padEnd(6, '').slice(0, 6).split(''));
                  inputs.current[Math.min(clean.length, 6) - 1]?.focus();
                } else {
                  setDigits(old => old.map((v, j) => (j === i ? clean : v)));
                  if (clean) {
                    inputs.current[i + 1]?.focus();
                  }
                }
              }}
              onKeyPress={({ nativeEvent }) => {
                if (nativeEvent.key === 'Backspace' && !digit) {
                  inputs.current[i - 1]?.focus();
                }
              }}
            />
          ))}
        </View>
        <Pressable
          disabled={seconds > 0}
          onPress={() => {
            setSeconds(28);
            Alert.alert('Demo OTP', 'Use 528471. No SMS was sent.');
          }}
        >
          <Text style={[s.text, s.center, { marginTop: 24 }]}>
            {seconds
              ? `Resend OTP in 00:${String(seconds).padStart(2, '0')}`
              : 'Resend OTP'}
          </Text>
        </Pressable>
        <View style={{ marginTop: 64 }}>
          <Button
            title="Verify OTP"
            onPress={() =>
              digits.join('') === '528471'
                ? nav.navigate('Profile')
                : Alert.alert('Invalid demo OTP', 'Enter 528471 to continue.')
            }
          />
          <Pressable onPress={() => nav.navigate('Welcome')}>
            <Text style={[s.link, s.center, { marginTop: 24 }]}>
              Change Mobile Number
            </Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}
export function Profile() {
  const nav = useNavigation<Navigation>();
  const { name, setName, setPatient } = useDemo();
  const [dob, setDob] = useState('15 Aug 2000');
  const [gender, setGender] = useState('Male');
  const [address, setAddress] = useState('Jhargram, West Bengal');
  return (
    <Screen
      title="Patient Profile"
      footer={
        <Button
          title="Save & Continue"
          disabled={!name.trim()}
          onPress={() => {
            setPatient(name);
            nav.navigate('Family');
          }}
        />
      }
    >
      <View style={{ alignItems: 'center', marginBottom: 8 }}>
        <Avatar size={95} />
        <Pressable
          accessibilityLabel="Change profile photo"
          onPress={() =>
            Alert.alert(
              'Profile photo',
              'Photo upload will be connected in the dynamic version.',
            )
          }
          style={styles.camera}
        >
          <Camera size={17} color="#fff" />
        </Pressable>
      </View>
      <Field label="Full Name *" value={name} onChangeText={setName} />
      <Field label="Date of Birth" value={dob} onChangeText={setDob} />
      <Text style={s.label}>Gender</Text>
      <View style={[s.between, { flexWrap: 'wrap' }]}>
        {['Male', 'Female', 'Other'].map(item => (
          <Radio
            key={item}
            label={item}
            selected={gender === item}
            onPress={() => setGender(item)}
          />
        ))}
      </View>
      <Field label="Address" value={address} onChangeText={setAddress} />
    </Screen>
  );
}
export function Family() {
  const nav = useNavigation<Navigation>();
  const { family, setFamily, name } = useDemo();
  const [adding, setAdding] = useState(false);
  const [member, setMember] = useState('');
  const [relation, setRelation] = useState('Spouse');
  const [age, setAge] = useState('');
  return (
    <Screen
      title="Family Members"
      footer={
        <View style={{ gap: 10 }}>
          <Button
            title="Add Family Member"
            icon={Plus}
            onPress={() => setAdding(true)}
          />
          <Pressable onPress={() => nav.navigate('Home')}>
            <Text style={[s.link, s.center]}>
              Continue to Home <ChevronRight size={12} />
            </Text>
          </Pressable>
        </View>
      }
    >
      {family.map((item, i) => (
        <View
          key={`${item.name}-${i}`}
          style={[
            s.row,
            {
              paddingVertical: 16,
              borderBottomWidth: 1,
              borderColor: colors.line,
            },
          ]}
        >
          <Avatar size={53} female={item.female} />
          <View style={s.grow}>
            <Text style={[s.bold, { fontSize: 14 }]}>
              {i === 0 ? name : item.name}
            </Text>
            <Text style={s.small}>
              {item.relation} · {item.age} Years
            </Text>
          </View>
          <Pressable
            accessibilityLabel={`Manage ${item.name}`}
            onPress={() =>
              Alert.alert(
                item.name,
                i === 0
                  ? 'Edit your own details in My Profile.'
                  : 'Remove this member from the static demo?',
                i === 0
                  ? [{ text: 'OK' }]
                  : [
                      { text: 'Keep', style: 'cancel' },
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () =>
                          setFamily(family.filter((_, j) => j !== i)),
                      },
                    ],
              )
            }
          >
            <MoreVertical size={21} color={colors.navy} />
          </Pressable>
        </View>
      ))}
      <Modal
        visible={adding}
        transparent
        animationType="slide"
        onRequestClose={() => setAdding(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.overlay}
        >
          <SafeAreaView edges={['bottom']} style={styles.loginSheet}>
            <View style={s.between}>
              <Text style={s.title}>Add Family Member</Text>
              <Pressable
                accessibilityLabel="Close add family member"
                onPress={() => setAdding(false)}
              >
                <X color={colors.blue} />
              </Pressable>
            </View>
            <Field label="Full Name" value={member} onChangeText={setMember} />
            <Field
              label="Relationship"
              value={relation}
              onChangeText={setRelation}
            />
            <Field
              label="Age"
              keyboardType="number-pad"
              maxLength={3}
              value={age}
              onChangeText={setAge}
            />
            <View style={{ marginTop: 20 }}>
              <Button
                title="Save Member"
                disabled={!member.trim() || !age || Number(age) > 120}
                onPress={() => {
                  setFamily([
                    ...family,
                    { name: member, relation, age, female: false },
                  ]);
                  setMember('');
                  setAge('');
                  setAdding(false);
                }}
              />
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
const styles = StyleSheet.create({
  brandName: {
    fontSize: 34,
    fontWeight: '900',
    color: '#063264',
    letterSpacing: -1.4,
  },
  hero: {
    width: 250,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBubble: {
    position: 'absolute',
    width: 265,
    height: 170,
    backgroundColor: '#d8effb',
    borderRadius: 100,
    transform: [{ rotate: '-15deg' }],
  },
  tablet: {
    position: 'absolute',
    zIndex: 2,
    bottom: 17,
    left: 28,
    width: 53,
    height: 75,
    borderRadius: 8,
    backgroundColor: '#0d689f',
    transform: [{ rotate: '-15deg' }],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#06365b',
  },
  overlay: {
    flex: 1,
    backgroundColor: '#061c4277',
    justifyContent: 'flex-end',
  },
  loginSheet: {
    padding: 25,
    backgroundColor: '#fff',
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
  },
  otp: {
    flex: 1,
    width: 0,
    minWidth: 0,
    height: 53,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#becce0',
    borderRadius: 10,
    fontSize: 24,
    fontWeight: '800',
    color: colors.navy,
    backgroundColor: '#fff',
  },
  camera: {
    marginTop: -24,
    marginLeft: 45,
    backgroundColor: colors.blue,
    padding: 7,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#fff',
  },
});
