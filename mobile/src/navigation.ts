import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
export type ScreenName =
  | 'Welcome'
  | 'OTP'
  | 'Profile'
  | 'Family'
  | 'Home'
  | 'Clinics'
  | 'ClinicDetails'
  | 'Doctors'
  | 'DoctorProfile'
  | 'SelectAppointment'
  | 'VisitDetails'
  | 'Payment'
  | 'Confirmation'
  | 'Appointments'
  | 'AppointmentDetails'
  | 'CheckIn'
  | 'Queue'
  | 'TurnAlert'
  | 'Records'
  | 'Prescription'
  | 'LabReports'
  | 'Invoices'
  | 'Notifications'
  | 'Account';
export type Routes = { [K in ScreenName]: undefined };
export type Navigation = NativeStackNavigationProp<Routes>;
