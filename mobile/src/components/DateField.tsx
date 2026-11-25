import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react-native';

const blue = '#07598e';
const keyFor = (year: number, month: number, day: number) =>
  [year, String(month + 1).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function DateField({ label, value, onSelect, min, max }: {
  label: string;
  value: string;
  onSelect: (date: string) => void;
  min?: string;
  max?: string;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(new Date());
  const [chooseYear, setChooseYear] = useState(false);
  const year = month.getFullYear(), index = month.getMonth();
  const offset = new Date(year, index, 1).getDay();
  const days = new Date(year, index + 1, 0).getDate();
  const changeMonth = (step: number) => setMonth(new Date(year, index + step, 1));
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={label + (value ? ', ' + value : '')} style={styles.field} onPress={() => {
        const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T12:00:00') : new Date();
        setMonth(Number.isNaN(parsed.getTime()) ? new Date() : parsed);
        setChooseYear(false);
        setOpen(true);
      }}>
        <CalendarDays color={blue} size={20} />
        <Text style={styles.text}>{value || 'Choose a date'}</Text>
      </Pressable>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.card} accessibilityViewIsModal>
            <Text style={styles.heading}>{label}</Text>
            <View style={styles.header}>
              <Pressable accessibilityLabel="Previous month" hitSlop={8} onPress={() => chooseYear ? setMonth(new Date(year - 12, index, 1)) : changeMonth(-1)}><ChevronLeft color={blue} /></Pressable>
              <Pressable accessibilityRole="button" onPress={() => setChooseYear(!chooseYear)}><Text style={styles.heading}>{chooseYear ? 'Choose year' : months[index] + ' ' + year}</Text></Pressable>
              <Pressable accessibilityLabel="Next month" hitSlop={8} onPress={() => chooseYear ? setMonth(new Date(year + 12, index, 1)) : changeMonth(1)}><ChevronRight color={blue} /></Pressable>
            </View>
            {chooseYear ? <View style={styles.grid}>
              {Array.from({length: 12}, (_, i) => year - year % 12 + i).map(option =>
                <Pressable key={option} style={styles.year} onPress={() => { setMonth(new Date(option, index, 1)); setChooseYear(false); }}>
                  <Text style={styles.text}>{option}</Text>
                </Pressable>
              )}
            </View> : <View style={styles.grid}>
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => <Text key={day} style={[styles.cell, styles.weekday]}>{day}</Text>)}
              {Array.from({length: offset + days}, (_, i) => {
                const day = i - offset + 1;
                if (day < 1) return <View key={i} style={styles.cell} />;
                const date = keyFor(year, index, day);
                const disabled = Boolean((min && date < min) || (max && date > max));
                return <Pressable key={i} accessibilityRole="button" accessibilityLabel={date} accessibilityState={{selected: date === value, disabled}} disabled={disabled}
                  style={[styles.cell, date === value && styles.selected]} onPress={() => { onSelect(date); setOpen(false); }}>
                  <Text style={[styles.text, disabled && styles.disabled, date === value && styles.selectedText]}>{day}</Text>
                </Pressable>;
              })}
            </View>}
            <Pressable accessibilityRole="button" style={styles.cancel} onPress={() => setOpen(false)}><Text style={styles.heading}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: '#17304a', fontSize: 14, fontWeight: '700', marginBottom: 7 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 13, backgroundColor: '#fff', borderWidth: 1, borderColor: '#c8dcec', borderRadius: 12 },
  text: { color: '#17304a', fontSize: 14 },
  overlay: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#081e3a88' },
  card: { width: '100%', maxWidth: 440, alignSelf: 'center', padding: 16, backgroundColor: '#fff', borderRadius: 18, gap: 12 },
  heading: { fontSize: 16, fontWeight: '700', color: blue },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.28%', minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  weekday: { textAlign: 'center', color: '#526b83', paddingTop: 8, fontWeight: '600' },
  year: { width: '25%', minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  selected: { backgroundColor: blue, borderRadius: 11 },
  selectedText: { color: '#fff' },
  disabled: { opacity: 0.35 },
  cancel: { alignSelf: 'flex-end', padding: 10 },
});
