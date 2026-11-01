import {
  Activity,
  BedDouble,
  CalendarCheck2,
  ClipboardCheck,
  CreditCard,
  FlaskConical,
  HeartPulse,
  Hospital,
  PackageSearch,
  Pill,
  Stethoscope,
  Users,
} from "lucide-react";

export type Role =
  | "Clinic Admin"
  | "Reception"
  | "Doctor"
  | "Nurse"
  | "Laboratory"
  | "Pharmacy"
  | "Patient"
  | "Branch Admin"
  | "Inventory Manager"
  | "Accountant"
  | "HR Manager"
  | "Radiologist"
  | "Broker"
  | "Super Admin";

export const roles: Role[] = [
  "Clinic Admin",
  "Reception",
  "Doctor",
  "Nurse",
  "Laboratory",
  "Pharmacy",
  "Patient",
  "Branch Admin",
  "Inventory Manager",
  "Accountant",
  "HR Manager",
  "Broker",
  "Super Admin",
];

export const roleMetrics = {
  "Clinic Admin": [
    {
      label: "Today's patients",
      value: "428",
      change: "+8.2%",
      tone: "blue",
      icon: Users,
    },
    {
      label: "Today's revenue",
      value: "₹8.42L",
      change: "+12.4%",
      tone: "violet",
      icon: CreditCard,
    },
    {
      label: "Bed occupancy",
      value: "78%",
      change: "184 / 236",
      tone: "orange",
      icon: BedDouble,
    },
    {
      label: "Waiting patients",
      value: "32",
      change: "-6.1%",
      tone: "green",
      icon: HeartPulse,
    },
  ],
  Reception: [
    {
      label: "Today's appointments",
      value: "186",
      change: "+14 today",
      tone: "blue",
      icon: CalendarCheck2,
    },
    {
      label: "Checked in",
      value: "124",
      change: "67%",
      tone: "violet",
      icon: ClipboardCheck,
    },
    {
      label: "Waiting patients",
      value: "32",
      change: "8 urgent",
      tone: "orange",
      icon: Users,
    },
    {
      label: "New registrations",
      value: "28",
      change: "+9.4%",
      tone: "green",
      icon: Activity,
    },
  ],
  Doctor: [
    {
      label: "Today's appointments",
      value: "24",
      change: "6 remaining",
      tone: "blue",
      icon: CalendarCheck2,
    },
    {
      label: "Waiting patients",
      value: "6",
      change: "~18 min",
      tone: "orange",
      icon: Users,
    },
    {
      label: "Completed",
      value: "15",
      change: "63%",
      tone: "green",
      icon: ClipboardCheck,
    },
    {
      label: "Pending results",
      value: "8",
      change: "3 critical",
      tone: "violet",
      icon: FlaskConical,
    },
  ],
  Nurse: [
    {
      label: "Assigned patients",
      value: "18",
      change: "Ward 4B",
      tone: "blue",
      icon: Users,
    },
    {
      label: "Medications due",
      value: "12",
      change: "Next 2 hours",
      tone: "orange",
      icon: Pill,
    },
    {
      label: "Vitals due",
      value: "7",
      change: "2 overdue",
      tone: "violet",
      icon: HeartPulse,
    },
    {
      label: "Tasks completed",
      value: "84%",
      change: "+6.2%",
      tone: "green",
      icon: ClipboardCheck,
    },
  ],
  Laboratory: [
    {
      label: "Tests ordered",
      value: "238",
      change: "+11.2%",
      tone: "blue",
      icon: FlaskConical,
    },
    {
      label: "Samples pending",
      value: "34",
      change: "6 priority",
      tone: "orange",
      icon: Activity,
    },
    {
      label: "Awaiting verification",
      value: "18",
      change: "4 critical",
      tone: "violet",
      icon: ClipboardCheck,
    },
    {
      label: "Completed",
      value: "186",
      change: "78%",
      tone: "green",
      icon: HeartPulse,
    },
  ],
  Pharmacy: [
    {
      label: "Today's sales",
      value: "₹2.18L",
      change: "+9.2%",
      tone: "blue",
      icon: CreditCard,
    },
    {
      label: "Low stock items",
      value: "24",
      change: "8 critical",
      tone: "orange",
      icon: PackageSearch,
    },
    {
      label: "Inventory value",
      value: "₹48.6L",
      change: "+2.1%",
      tone: "violet",
      icon: Pill,
    },
    {
      label: "Orders filled",
      value: "312",
      change: "96.4%",
      tone: "green",
      icon: ClipboardCheck,
    },
  ],
  Patient: [
    {
      label: "Next appointment",
      value: "02 Aug",
      change: "10:30 AM",
      tone: "blue",
      icon: CalendarCheck2,
    },
    {
      label: "Active prescriptions",
      value: "3",
      change: "1 refill due",
      tone: "violet",
      icon: Pill,
    },
    {
      label: "Reports ready",
      value: "2",
      change: "View reports",
      tone: "green",
      icon: FlaskConical,
    },
    {
      label: "Outstanding bill",
      value: "₹3,250",
      change: "Due 05 Aug",
      tone: "orange",
      icon: CreditCard,
    },
  ],
  "Super Admin": [
    {
      label: "Total hospitals",
      value: "284",
      change: "+12 this month",
      tone: "blue",
      icon: Hospital,
    },
    {
      label: "Active subscriptions",
      value: "246",
      change: "86.6%",
      tone: "green",
      icon: ClipboardCheck,
    },
    {
      label: "Platform users",
      value: "48.2K",
      change: "+8.3%",
      tone: "violet",
      icon: Users,
    },
    {
      label: "Monthly revenue",
      value: "₹62.4L",
      change: "+14.8%",
      tone: "orange",
      icon: CreditCard,
    },
  ],
};

export const trendData = [
  { day: "1 Jul", revenue: 48, patients: 282, previous: 39 },
  { day: "5 Jul", revenue: 54, patients: 310, previous: 46 },
  { day: "9 Jul", revenue: 51, patients: 296, previous: 48 },
  { day: "13 Jul", revenue: 68, patients: 352, previous: 53 },
  { day: "17 Jul", revenue: 64, patients: 338, previous: 57 },
  { day: "21 Jul", revenue: 79, patients: 402, previous: 62 },
  { day: "25 Jul", revenue: 74, patients: 384, previous: 66 },
  { day: "29 Jul", revenue: 88, patients: 428, previous: 71 },
];

export const departments = [
  { name: "Cardiology", value: 28, amount: "₹2.36L", color: "#5b8def" },
  { name: "Orthopaedics", value: 22, amount: "₹1.85L", color: "#8b5cf6" },
  { name: "General Medicine", value: 19, amount: "₹1.60L", color: "#22b8a7" },
  { name: "Diagnostics", value: 17, amount: "₹1.43L", color: "#f59e6a" },
  { name: "Other", value: 14, amount: "₹1.18L", color: "#cbd5e1" },
];

export const queue = [
  {
    token: "A-032",
    name: "Meera Joshi",
    meta: "Cardiology · Dr. A. Shah",
    time: "10:40",
    status: "In consultation",
    tone: "green",
  },
  {
    token: "A-033",
    name: "Rohan Mehta",
    meta: "Cardiology · Dr. A. Shah",
    time: "10:55",
    status: "Waiting",
    tone: "orange",
  },
  {
    token: "B-018",
    name: "Anaya Singh",
    meta: "Orthopaedics · Dr. R. Rao",
    time: "11:00",
    status: "Checked in",
    tone: "blue",
  },
  {
    token: "C-041",
    name: "Arjun Patel",
    meta: "General Medicine · Dr. P. Sen",
    time: "11:10",
    status: "Waiting",
    tone: "orange",
  },
  {
    token: "D-009",
    name: "Isha Verma",
    meta: "Paediatrics · Dr. N. Bose",
    time: "11:15",
    status: "Confirmed",
    tone: "violet",
  },
];

export const activityFeed = [
  {
    icon: CreditCard,
    title: "Payment received",
    detail: "INV-240719 · Meera Joshi",
    value: "+ ₹12,480",
    time: "4 min",
  },
  {
    icon: BedDouble,
    title: "Patient discharged",
    detail: "IPD-00842 · Ward 4B",
    value: "Room 412",
    time: "12 min",
  },
  {
    icon: FlaskConical,
    title: "Critical result verified",
    detail: "LAB-18409 · Troponin I",
    value: "Critical",
    time: "18 min",
  },
  {
    icon: Stethoscope,
    title: "Consultation completed",
    detail: "Dr. A. Shah · OPD-1248",
    value: "Completed",
    time: "24 min",
  },
];

export const reportCategories = [
  {
    title: "Patients",
    count: 8,
    icon: Users,
    color: "blue",
    reports: [
      "Patient registration",
      "Patient visits",
      "New vs returning",
      "OPD & IPD",
    ],
  },
  {
    title: "Appointments",
    count: 6,
    icon: CalendarCheck2,
    color: "violet",
    reports: ["Appointment report", "By doctor", "Cancellations", "No-shows"],
  },
  {
    title: "Clinical",
    count: 14,
    icon: Stethoscope,
    color: "green",
    reports: ["Doctor performance", "Bed occupancy", "Laboratory", "Radiology"],
  },
  {
    title: "Finance",
    count: 17,
    icon: CreditCard,
    color: "orange",
    reports: ["Revenue", "Outstanding dues", "Profit & loss", "Cash flow"],
  },
  {
    title: "Pharmacy",
    count: 11,
    icon: Pill,
    color: "rose",
    reports: ["Sales", "Stock movement", "Expiry", "Top medicines"],
  },
  {
    title: "Workforce",
    count: 5,
    icon: ClipboardCheck,
    color: "slate",
    reports: ["Employees", "Attendance", "Leave", "Payroll"],
  },
];
