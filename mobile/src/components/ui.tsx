import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import {
  ArrowLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  House,
  LayoutGrid,
  Search,
  UserRound,
  Waves,
  X,
  CalendarDays,
  type LucideIcon,
} from 'lucide-react-native';
import { colors, s } from '../theme';
import { BodyWaves, ClinicLandscape, HeaderArt } from './HealthArtwork';
import type { Navigation, ScreenName } from '../navigation';
export const screenNames: [ScreenName, string][] = [
  ['Welcome', 'Welcome / Login'],
  ['OTP', 'OTP Verification'],
  ['Profile', 'Patient Profile Setup'],
  ['Family', 'Family Members'],
  ['Home', 'Home'],
  ['Clinics', 'Clinic Search / Listing'],
  ['ClinicDetails', 'Clinic Details'],
  ['Doctors', 'Doctor Search / Listing'],
  ['DoctorProfile', 'Doctor Profile'],
  ['SelectAppointment', 'Select Appointment'],
  ['VisitDetails', 'Visit Details'],
  ['Payment', 'Review and Payment'],
  ['Confirmation', 'Booking Confirmation'],
  ['Appointments', 'My Appointments'],
  ['AppointmentDetails', 'Appointment Details'],
  ['CheckIn', 'Patient Check-in'],
  ['Queue', 'Live Queue'],
  ['TurnAlert', 'Turn Alert / Consultation'],
  ['Records', 'Medical Records'],
  ['Prescription', 'Prescription Details'],
  ['LabReports', 'Lab Tests and Reports'],
  ['Invoices', 'Payments and Invoices'],
  ['Notifications', 'Notifications'],
  ['Account', 'Account, Settings & Help'],
];
export function Button({
  title,
  onPress,
  secondary,
  icon: Icon,
  disabled,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  icon?: LucideIcon;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
      })}
    >
      <LinearGradient
        colors={secondary ? ['#ffffff', '#f0f9ff'] : ['#0797d7', '#005eaa']}
        style={[styles.button, secondary && styles.secondary]}
      >
        {Icon && <Icon size={20} color={secondary ? colors.blue : '#fff'} />}
        <Text style={[styles.buttonText, secondary && s.blue]}>{title}</Text>
      </LinearGradient>
    </Pressable>
  );
}
export function Screen({
  title,
  children,
  footer,
  tab,
  light = false,
  scroll = true,
  right,
  immersive = false,
}: React.PropsWithChildren<{
  title?: string;
  footer?: React.ReactNode;
  tab?: ScreenName;
  light?: boolean;
  scroll?: boolean;
  right?: React.ReactNode;
  immersive?: boolean;
}>) {
  const nav = useNavigation<Navigation>();
  const [gallery, setGallery] = useState(false);
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={light ? ['#f1f9ff', '#fff'] : ['#048fca', '#00589f']}
      style={styles.root}
    >
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
        {focused && (
          <StatusBar barStyle={light ? 'dark-content' : 'light-content'} />
        )}
        {title && (
          <View style={styles.header}>
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <HeaderArt />
            </View>
            <Pressable
              accessibilityLabel="Go back"
              hitSlop={14}
              onPress={() =>
                nav.canGoBack() ? nav.goBack() : nav.navigate('Home')
              }
            >
              <ArrowLeft color={light ? colors.navy : '#fff'} size={23} />
            </Pressable>
            <Text style={[styles.headerText, light && { color: colors.navy }]}>
              {title}
            </Text>
            {right || <View style={{ width: 23 }} />}
          </View>
        )}
        <View style={[styles.sheet, !title && styles.noRound]}>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <BodyWaves />
          </View>
          {!scroll && !immersive && (
            <View
              pointerEvents="none"
              style={[
                styles.landscape,
                { bottom: (footer ? 72 : 0) + (tab ? 71 : 0) },
              ]}
            >
              <ClinicLandscape />
            </View>
          )}
          {scroll ? (
            <ScrollView
              contentContainerStyle={[
                styles.content,
                { paddingBottom: 0, flexGrow: 1 },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View>{children}</View>
              <View
                pointerEvents="none"
                style={{
                  height: tab === 'Home' ? 105 : 145,
                  marginHorizontal: -20,
                  marginTop: 'auto',
                }}
              >
                <ClinicLandscape />
              </View>
            </ScrollView>
          ) : (
            <View
              style={[
                styles.content,
                s.grow,
                immersive && { paddingBottom: 20 },
              ]}
            >
              {children}
            </View>
          )}
          {footer && <View style={styles.footer}>{footer}</View>}
          {tab && <BottomBar active={tab} />}
          <SafeAreaView edges={['bottom']} />
        </View>
        {__DEV__ && (
          <Pressable
            accessibilityLabel="Open all 24 screen previews"
            onPress={() => setGallery(true)}
            style={[styles.gallery, { top: insets.top + 2 }]}
          >
            <LayoutGrid size={17} color={colors.blue} />
          </Pressable>
        )}
        <Modal
          visible={gallery}
          animationType="slide"
          onRequestClose={() => setGallery(false)}
        >
          <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
            <View style={{ padding: 20 }}>
              <View style={s.between}>
                <Text style={s.title}>24 screen previews</Text>
                <Pressable
                  accessibilityLabel="Close previews"
                  onPress={() => setGallery(false)}
                >
                  <X color={colors.blue} />
                </Pressable>
              </View>
              <Text style={s.small}>
                Static demo · no API requests or real payments
              </Text>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              {screenNames.map(([route, label], i) => (
                <Pressable
                  key={route}
                  onPress={() => {
                    setGallery(false);
                    nav.navigate(route);
                  }}
                  style={[s.card, s.row]}
                >
                  <Text style={[s.bold, s.blue]}>
                    {String(i + 1).padStart(2, '0')}
                  </Text>
                  <Text style={[s.text, s.grow]}>{label}</Text>
                  <ChevronRight size={18} color={colors.blue} />
                </Pressable>
              ))}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </LinearGradient>
  );
}
function BottomBar({ active }: { active: ScreenName }) {
  const nav = useNavigation<Navigation>();
  const tabs: [ScreenName, string, LucideIcon][] = [
    ['Home', 'Home', House],
    ['Appointments', 'Appointments', CalendarDays],
    ['Queue', 'Queue', Waves],
    ['Records', 'Records', FileText],
    ['Account', 'Account', UserRound],
  ];
  return (
    <View style={styles.tabs}>
      {tabs.map(([route, label, Icon]) => (
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: active === route }}
          key={route}
          onPress={() => nav.navigate(route)}
          style={styles.tab}
        >
          <Icon
            size={25}
            color={active === route ? colors.bright : colors.navy}
            strokeWidth={active === route ? 2.7 : 1.7}
            fill={
              active === route && route === 'Home' ? colors.blue : 'transparent'
            }
          />
          <Text
            style={{
              fontSize: 11,
              color: active === route ? colors.blue : colors.navy,
              fontWeight: '600',
            }}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor="#8190a4" style={s.input} {...props} />
    </View>
  );
}
export function Chips({
  items,
  selected,
  onSelect,
}: {
  items: string[];
  selected: string;
  onSelect: (item: string) => void;
}) {
  return (
    <View style={[s.row, { flexWrap: 'wrap', gap: 7, marginVertical: 10 }]}>
      {items.map(item => (
        <Pressable
          key={item}
          accessibilityRole="button"
          accessibilityState={{ selected: item === selected }}
          onPress={() => onSelect(item)}
          style={[
            styles.chip,
            item === selected && { backgroundColor: colors.blue },
          ]}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: '700',
              color: item === selected ? '#fff' : colors.navy,
            }}
          >
            {item}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function SearchBar({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
}) {
  return (
    <View style={[s.row, s.input]}>
      <Search size={19} color={colors.blue} />
      <TextInput
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChangeText}
        style={[s.grow, { color: colors.text, padding: 0, fontSize: 13 }]}
      />
    </View>
  );
}
export function Badge({
  text,
  tone = 'blue',
}: {
  text: string;
  tone?: 'blue' | 'green' | 'red' | 'yellow';
}) {
  const palette = {
    blue: ['#e4efff', colors.blue],
    green: ['#d8f8e2', colors.green],
    red: ['#ffe8ed', colors.red],
    yellow: ['#fff2bb', '#ad6900'],
  }[tone];
  return (
    <View
      style={{
        backgroundColor: palette[0],
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 4,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: palette[1], fontSize: 12, fontWeight: '700' }}>
        {text}
      </Text>
    </View>
  );
}
export function Row({
  icon: Icon,
  title,
  value,
  onPress,
  danger,
}: {
  icon?: LucideIcon;
  title: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={styles.menuRow}>
      {Icon && (
        <View style={styles.menuIcon}>
          <Icon size={20} color={danger ? colors.red : colors.blue} />
        </View>
      )}
      <Text
        style={[
          s.text,
          s.grow,
          { fontWeight: '600' },
          danger && { color: colors.red },
        ]}
      >
        {title}
      </Text>
      {value && <Text style={s.small}>{value}</Text>}
      {onPress && <ChevronRight size={18} color={colors.navy} />}
    </Pressable>
  );
}
export function Radio({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[s.row, { paddingVertical: 8 }]}
    >
      <View
        style={{
          height: 20,
          width: 20,
          borderRadius: 10,
          borderWidth: selected ? 6 : 1.5,
          borderColor: selected ? colors.blue : '#8295ae',
        }}
      />
      <Text style={s.text}>{label}</Text>
    </Pressable>
  );
}
export function Empty({ text }: { text: string }) {
  return (
    <View style={[s.card, { alignItems: 'center', paddingVertical: 36 }]}>
      <ClipboardList color={colors.blue} size={35} />
      <Text style={[s.text, s.center]}>{text}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    height: 78,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerText: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: '#fff',
    flex: 1,
    textAlign: 'center',
  },
  sheet: {
    flex: 1,
    backgroundColor: colors.bg,
    marginTop: -2,
    overflow: 'hidden',
  },
  noRound: { borderRadius: 0 },
  content: { padding: 20, paddingBottom: 145 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    backgroundColor: '#f4fafff5',
  },
  button: {
    minHeight: 49,
    borderRadius: 17,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 9,
    padding: 12,
    boxShadow: '0px 5px 12px rgba(0, 107, 178, 0.14)',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondary: { borderWidth: 1, borderColor: '#a2bad6' },
  tabs: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#fff',
  },
  tab: { alignItems: 'center', gap: 5, flex: 1 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.pale,
    borderRadius: 18,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  menuIcon: { padding: 7, borderRadius: 12, backgroundColor: '#e1f3ffb3' },
  landscape: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 145,
    opacity: 0.82,
  },
  gallery: {
    position: 'absolute',
    right: 5,
    top: 2,
    padding: 5,
    backgroundColor: '#ffffffdf',
    borderRadius: 8,
  },
});
