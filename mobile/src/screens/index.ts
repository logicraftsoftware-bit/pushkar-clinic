import { Welcome, OTP, Profile, Family } from './Onboarding';
import {
  Home,
  Clinics,
  ClinicDetails,
  Doctors,
  DoctorProfile,
} from './Discovery';
import {
  SelectAppointment,
  VisitDetails,
  Payment,
  Confirmation,
} from './Booking';
import {
  Appointments,
  AppointmentDetails,
  CheckIn,
  Queue,
  TurnAlert,
} from './Appointments';
import {
  Records,
  Prescription,
  LabReports,
  Invoices,
  Notifications,
  Account,
} from './RecordsAccount';
import type { ScreenName } from '../navigation';
import type { ComponentType } from 'react';
export const screens: Record<ScreenName, ComponentType> = {
  Welcome,
  OTP,
  Profile,
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
  TurnAlert,
  Records,
  Prescription,
  LabReports,
  Invoices,
  Notifications,
  Account,
};
