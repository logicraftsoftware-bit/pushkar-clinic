import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Phone,
  UserRound,
} from 'lucide-react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { Avatar } from '../components/Illustrations';
import { api } from './native';
import type { Tokens } from './client';
import type { Navigation } from '../navigation';
import { usePatient } from './PatientContext';
type Mode = 'login' | 'register' | 'reset' | 'otp';
type Challenge = { challenge_id: string; resend_after: number };
export function PatientAuth() {
  const nav = useNavigation<Navigation>(),
    patient = usePatient();
  const [mode, setMode] = useState<Mode>('login'),
    [phone, setPhone] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [confirm, setConfirm] = useState(''),
    [code, setCode] = useState(''),
    [visible, setVisible] = useState(false),
    [challenge, setChallenge] = useState<Challenge | null>(null),
    [resetToken, setResetToken] = useState(''),
    [cooldown, setCooldown] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const running = useRef(false);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(n => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => {
    if (patient.signedIn)
      nav.reset({
        index: 0,
        routes: [{ name: patient.me?.profile.name ? 'Home' : 'Profile' }],
      });
  }, [patient.signedIn, patient.me?.profile.name, nav]);
  function change(next: Mode) {
    setMode(next);
    setPassword('');
    setConfirm('');
    setCode('');
    setChallenge(null);
    setResetToken('');
    setError('');
    setCooldown(0);
    setVisible(false);
  }
  async function run(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Unable to continue. Try again.',
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function finish(tokens: Tokens) {
    await api.save(tokens);
    const me = await patient.loadMe();
    nav.reset({
      index: 0,
      routes: [{ name: me.profile.name ? 'Home' : 'Profile' }],
    });
  }
  async function send() {
    if (!/^[6-9]\d{9}$/.test(phone))
      throw Error('Enter a valid 10-digit mobile number.');
    if (mode === 'register' && (name.trim().length < 2 || password.length < 12))
      throw Error(
        'Enter your full name and a password of at least 12 characters.',
      );
    const next = await api.request<Challenge>(
      '/auth/otp/request',
      'POST',
      {
        phone: '+91' + phone,
        purpose:
          mode === 'register'
            ? 'register'
            : mode === 'reset'
            ? 'reset'
            : 'login',
        ...(mode === 'register'
          ? {
              name: name.trim(),
              password,
              ...(email.trim() ? { email: email.trim() } : {}),
            }
          : {}),
      },
      { public: true },
    );
    setChallenge(next);
    setCooldown(next.resend_after);
    setCode('');
  }
  async function verify() {
    if (!challenge || !/^\d{6}$/.test(code))
      throw Error('Enter the six-digit OTP.');
    if (mode === 'reset') {
      const result = await api.request<{ reset_token: string }>(
        '/auth/otp/verify',
        'POST',
        { challenge_id: challenge.challenge_id, code },
        { public: true },
      );
      setResetToken(result.reset_token);
      setCode('');
      setPassword('');
      setConfirm('');
    } else
      await finish(
        await api.request<Tokens>(
          '/auth/otp/verify',
          'POST',
          { challenge_id: challenge.challenge_id, code },
          { public: true },
        ),
      );
  }
  const title = {
    login: 'Welcome to Pushkar Clinic',
    register: 'Create Account',
    reset: 'Forgot Password',
    otp: 'Login with OTP',
  }[mode];
  const intro = {
    login:
      'Login to book appointments, follow your queue and access your health records.',
    register:
      'Create your account to book appointments and manage your health.',
    reset: 'Reset your password using mobile OTP verification.',
    otp: 'Sign in securely using a one-time password sent to your mobile.',
  }[mode];
  function field(
    label: string,
    value: string,
    onChange: (value: string) => void,
    Icon: typeof Phone,
    secret = false,
  ) {
    return (
      <View style={a.field}>
        <Icon size={20} color="#6f2559" />
        <TextInput
          accessibilityLabel={label}
          placeholder={label}
          placeholderTextColor="#8f8093"
          style={a.input}
          value={value}
          onChangeText={onChange}
          editable={!busy && (!challenge || (secret && Boolean(resetToken)))}
          keyboardType={
            label === 'Mobile number'
              ? 'phone-pad'
              : label.includes('Email')
              ? 'email-address'
              : 'default'
          }
          autoCapitalize={label === 'Full name' ? 'words' : 'none'}
          maxLength={label === 'Mobile number' ? 10 : 128}
          secureTextEntry={secret && !visible}
          autoCorrect={false}
        />
        {secret && (
          <Pressable
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
            onPress={() => setVisible(v => !v)}
          >
            {visible ? (
              <EyeOff size={20} color="#77586e" />
            ) : (
              <Eye size={20} color="#77586e" />
            )}
          </Pressable>
        )}
      </View>
    );
  }
  function button(
    label: string,
    onPress: () => Promise<void>,
    disabled = false,
  ) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={busy || disabled}
        onPress={() => void run(onPress)}
        style={{ opacity: busy || disabled ? 0.5 : 1 }}
      >
        <LinearGradient colors={['#e00085', '#97005b']} style={a.button}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={a.buttonText}>{label}</Text>
          )}
        </LinearGradient>
      </Pressable>
    );
  }
  return (
    <LinearGradient colors={['#fff2fa', '#fff', '#fff3fa']} style={{ flex: 1 }}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={a.content}
          >
            <Svg
              height={40}
              width="100%"
              viewBox="0 0 400 55"
              preserveAspectRatio="none"
            >
              <Path d="M0 0H400V30Q300 65 190 29T0 40Z" fill="#ffd3ec" />
              <Path
                d="M0 0H400V12Q240 55 120 10T0 20Z"
                fill="#f8aed8"
                opacity=".5"
              />
            </Svg>
            {mode !== 'login' && (
              <Pressable
                accessibilityLabel="Back to login"
                style={a.back}
                onPress={() => change('login')}
              >
                <ArrowLeft size={22} color="#651342" />
                <Text style={a.backText}>{title}</Text>
              </Pressable>
            )}
            <View style={a.brand}>
              <View style={a.logo}>
                <Image
                  source={require('../assets/pushkar-logo.png')}
                  style={{ width: 134, height: 46 }}
                  resizeMode="contain"
                />
              </View>
              <Text style={a.brandName}>PUSHKAR CLINIC</Text>
              <Text style={a.tag}>Your health. Our care.</Text>
            </View>
            {mode === 'login' && (
              <View style={{ alignItems: 'center', marginBottom: 12 }}>
                <Avatar doctor size={80} />
                <Text style={a.title}>{title}</Text>
              </View>
            )}
            <Text style={a.intro}>{intro}</Text>
            <View style={a.card}>
              {error ? (
                <Text accessibilityRole="alert" style={a.error}>
                  {error}
                </Text>
              ) : null}
              {mode === 'register' &&
                field('Full name', name, setName, UserRound)}
              {field('Mobile number', phone, setPhone, Phone)}
              {mode === 'register' &&
                field('Email (optional)', email, setEmail, Mail)}
              {(mode === 'login' || mode === 'register' || resetToken) &&
                field(
                  resetToken ? 'New password' : 'Password',
                  password,
                  setPassword,
                  LockKeyhole,
                  true,
                )}
              {resetToken &&
                field(
                  'Confirm new password',
                  confirm,
                  setConfirm,
                  LockKeyhole,
                  true,
                )}
              {(mode === 'register' || resetToken) && (
                <Text style={a.hint}>
                  Use at least 12 characters for your password.
                </Text>
              )}
              {mode === 'login' ? (
                <>
                  {button(
                    'Login',
                    async () => {
                      await finish(
                        await api.request<Tokens>(
                          '/auth/password/login',
                          'POST',
                          { phone: '+91' + phone, password },
                          { public: true },
                        ),
                      );
                    },
                    !phone || !password,
                  )}
                  <View style={a.links}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Forgot password?"
                      onPress={() => change('reset')}
                    >
                      <Text style={a.link}>Forgot password?</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Login with OTP"
                      onPress={() => change('otp')}
                    >
                      <Text style={a.link}>Login with OTP</Text>
                    </Pressable>
                  </View>
                  <Text style={a.hint}>Don’t have an account?</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Register / Create Account"
                    onPress={() => change('register')}
                    style={a.register}
                  >
                    <Text style={a.link}>Register / Create Account</Text>
                  </Pressable>
                </>
              ) : resetToken ? (
                button(
                  'Save password & login',
                  async () => {
                    if (password !== confirm)
                      throw Error('Passwords do not match.');
                    await finish(
                      await api.request<Tokens>(
                        '/auth/password/reset',
                        'POST',
                        { reset_token: resetToken, password },
                        { public: true },
                      ),
                    );
                  },
                  password.length < 12 || !confirm,
                )
              ) : (
                <>
                  {!challenge && button('Send OTP', send)}
                  {challenge && (
                    <View style={a.otp}>
                      <Text style={a.otpTitle}>Enter OTP</Text>
                      <Text style={a.hint}>
                        Enter the six-digit code sent to your mobile. It expires
                        in 5 minutes.
                      </Text>
                      <TextInput
                        accessibilityLabel="Six-digit OTP"
                        value={code}
                        onChangeText={v => setCode(v.replace(/\D/g, ''))}
                        keyboardType="number-pad"
                        textContentType="oneTimeCode"
                        autoComplete="sms-otp"
                        maxLength={6}
                        style={a.code}
                      />
                      {button(
                        mode === 'register'
                          ? 'Verify & create account'
                          : mode === 'reset'
                          ? 'Verify OTP'
                          : 'Verify & login',
                        verify,
                        code.length !== 6,
                      )}
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy || cooldown > 0}
                        onPress={() => void run(send)}
                      >
                        <Text
                          style={[
                            a.link,
                            { textAlign: 'center', marginTop: 16 },
                          ]}
                        >
                          {cooldown ? `Resend in ${cooldown}s` : 'Resend OTP'}
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => change(mode)}
                      >
                        <Text
                          style={[a.hint, { textDecorationLine: 'underline' }]}
                        >
                          Edit details
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </>
              )}
            </View>
            <Text style={a.footer}>
              Secure access to your own appointments and health records.
            </Text>
            <Svg height={110} width="100%" viewBox="0 0 400 110">
              <Path d="M0 70Q100 25 200 70T400 70V110H0Z" fill="#f7c9e3" />
              <Rect
                x={157}
                y={34}
                width={86}
                height={76}
                rx={5}
                fill="#fff"
                stroke="#ec99c9"
                strokeWidth={3}
              />
              <Path
                d="M146 36L200 12L254 36"
                stroke="#c70075"
                strokeWidth={7}
                fill="none"
              />
              <Path d="M197 42H204V67H197ZM188 51H213V58H188Z" fill="#cf007a" />
              <Rect x={185} y={80} width={29} height={30} fill="#eba8d0" />
            </Svg>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}
const a = StyleSheet.create({
  content: { paddingHorizontal: 20, flexGrow: 1 },
  brand: { alignItems: 'center', paddingTop: 10, marginBottom: 20 },
  logo: {
    backgroundColor: '#cf007b',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  brandName: {
    fontSize: 23,
    fontWeight: '800',
    color: '#681044',
    marginTop: 12,
  },
  tag: { fontSize: 13, color: '#75566e', marginTop: 4 },
  title: {
    fontSize: 23,
    fontWeight: '800',
    color: '#441034',
    marginTop: 10,
    textAlign: 'center',
  },
  intro: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    color: '#503548',
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#ffffffd9',
    padding: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#f1d6e7',
    gap: 12,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#decbd9',
    borderRadius: 13,
    paddingHorizontal: 13,
    minHeight: 52,
    backgroundColor: '#fff',
  },
  input: { flex: 1, fontSize: 16, color: '#302032', paddingVertical: 12 },
  button: {
    minHeight: 52,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  links: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginVertical: 8,
  },
  link: { fontSize: 14, fontWeight: '700', color: '#b80070' },
  hint: { fontSize: 13, lineHeight: 19, color: '#827180', textAlign: 'center' },
  register: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d994bc',
    borderRadius: 30,
    padding: 10,
  },
  otp: { backgroundColor: '#fff0f8', borderRadius: 16, padding: 14, gap: 10 },
  otpTitle: { fontSize: 17, fontWeight: '700', color: '#4e163c' },
  code: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ecc5dd',
    borderRadius: 12,
    padding: 12,
    textAlign: 'center',
    fontSize: 25,
    letterSpacing: 10,
    color: '#671449',
  },
  error: {
    backgroundColor: '#fff0f1',
    color: '#ad2348',
    padding: 12,
    borderRadius: 12,
    lineHeight: 20,
  },
  footer: {
    textAlign: 'center',
    color: '#94768b',
    fontSize: 12,
    marginVertical: 20,
  },
  back: {
    flexDirection: 'row',
    gap: 15,
    alignItems: 'center',
    paddingVertical: 10,
  },
  backText: { fontSize: 20, fontWeight: '700', color: '#58113e' },
});
