import React, { createContext, useContext, useState } from 'react';
export const doctors = [
  {
    name: 'Dr. Arindam Sen',
    specialty: 'Cardiology',
    fee: 700,
    rating: '4.6',
    reviews: 420,
    next: '11:30 AM',
    female: false,
  },
  {
    name: 'Dr. Priyanka Roy',
    specialty: 'General Physician',
    fee: 500,
    rating: '4.7',
    reviews: 386,
    next: '12:00 PM',
    female: true,
  },
  {
    name: 'Dr. Souvik Das',
    specialty: 'Orthopedics',
    fee: 600,
    rating: '4.6',
    reviews: 276,
    next: '2:00 PM',
    female: false,
  },
];
export const clinics = [
  {
    name: 'MediCity Multispeciality Hospital',
    rating: '4.6',
    reviews: '1,248',
    distance: '1.2',
    hours: '8:00 AM – 8:00 PM',
    type: 'Hospital',
  },
  {
    name: 'LifeCare Clinic',
    rating: '4.4',
    reviews: '532',
    distance: '2.3',
    hours: '9:00 AM – 8:00 PM',
    type: 'Clinic',
  },
  {
    name: 'HealthPlus Clinic',
    rating: '4.3',
    reviews: '410',
    distance: '3.1',
    hours: '8:00 AM – 9:00 PM',
    type: 'Diagnostic',
  },
];
export const initialFamily = [
  {
    name: 'Dwaipayan Bhattacharya',
    relation: 'Self',
    age: '26',
    female: false,
  },
  { name: 'Sananda Das', relation: 'Spouse', age: '25', female: true },
  { name: 'Maa Bhattacharya', relation: 'Mother', age: '52', female: true },
  { name: 'Baba Bhattacharya', relation: 'Father', age: '56', female: false },
];
function useDemoState() {
  const [name, setName] = useState(initialFamily[0].name);
  const [phone, setPhone] = useState('9876543210');
  const [family, setFamily] = useState(initialFamily);
  const [doctorIndex, setDoctorIndex] = useState(0);
  const [clinicIndex, setClinicIndex] = useState(0);
  const [patient, setPatient] = useState(initialFamily[0].name);
  const [day, setDay] = useState('13');
  const [time, setTime] = useState('11:30 AM');
  const [visitType, setVisitType] = useState('New Visit');
  const [booked, setBooked] = useState(true);
  const [checkedIn, setCheckedIn] = useState(false);
  const [read, setRead] = useState(false);
  return {
    name,
    setName,
    phone,
    setPhone,
    family,
    setFamily,
    doctorIndex,
    setDoctorIndex,
    clinicIndex,
    setClinicIndex,
    patient,
    setPatient,
    day,
    setDay,
    time,
    setTime,
    visitType,
    setVisitType,
    booked,
    setBooked,
    checkedIn,
    setCheckedIn,
    read,
    setRead,
    doctor: doctors[doctorIndex],
    clinic: clinics[clinicIndex],
  };
}
const Context = createContext<ReturnType<typeof useDemoState> | null>(null);
export function DemoProvider({ children }: React.PropsWithChildren) {
  return <Context.Provider value={useDemoState()}>{children}</Context.Provider>;
}
export function useDemo() {
  const value = useContext(Context);
  if (!value) {
    throw new Error('DemoProvider missing');
  }
  return value;
}
