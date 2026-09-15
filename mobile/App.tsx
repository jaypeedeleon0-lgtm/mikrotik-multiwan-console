import React, { useState, useEffect } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  FlatList,
  Alert,
  Dimensions,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================
interface WanInterface {
  name: string;
  label: string;
  gateway: string;
  status: 'ACTIVE' | 'BACKUP' | 'DISABLED';
  tx: string;
  rx: string;
  lastSpeedtest?: string;
}

export default function App() {
  // Theme State
  const [isDarkMode, setIsDarkMode] = useState(true);

  // Connection Form State
  const [host, setHost] = useState('172.16.10.1');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [port, setPort] = useState('8728');
  const [isConnected, setIsConnected] = useState(false);
  const [targetIp, setTargetIp] = useState('172.16.10.248');

  // WAN Interfaces State
  const [wanList, setWanList] = useState<WanInterface[]>([
    {
      name: 'ether10_ALEX',
      label: 'PLDT-RESI-ALEX',
      gateway: '122.52.16.1',
      status: 'ACTIVE',
      tx: '11.2 Mbps',
      rx: '2.4 Mbps',
      lastSpeedtest: '245.5 Mbps',
    },
    {
      name: 'ether14_MAK',
      label: 'PLDT-RESI-MAK',
      gateway: '119.94.32.1',
      status: 'ACTIVE',
      tx: '6.4 Mbps',
      rx: '1.1 Mbps',
      lastSpeedtest: '189.0 Mbps',
    },
    {
      name: 'ether15_DARYLLE',
      label: 'PLDT-RESI-DARYLLE',
      gateway: '119.94.32.1',
      status: 'ACTIVE',
      tx: '3.1 Mbps',
      rx: '0.8 Mbps',
      lastSpeedtest: '150.2 Mbps',
    },
  ]);

  // Handle Connect
  const handleConnect = () => {
    if (!host || !username) {
      Alert.alert('Validation Error', 'Please enter Router IP and Username.');
      return;
    }
    setIsConnected(true);
    Alert.alert('Connected', `Successfully connected to MikroTik Router at ${host}`);
  };

  // Dynamic Theme Colors
  const colors = {
    bg: isDarkMode ? '#000000' : '#f8fafc',
    card: isDarkMode ? '#111111' : '#ffffff',
    border: isDarkMode ? 'rgba(255, 255, 255, 0.12)' : '#e2e8f0',
    text: isDarkMode ? '#ffffff' : '#0f172a',
    muted: isDarkMode ? '#a1a1aa' : '#64748b',
    accent: '#10b981',
    cyan: '#00f2fe',
    inputBg: isDarkMode ? '#09090b' : '#f1f5f9',
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={colors.bg} />

      {/* TOP HEADER BAR */}
      <View style={[styles.header, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Row 1: Logo Title + Orb */}
        <View style={styles.logoRow}>
          <View style={[styles.statusOrb, { backgroundColor: isConnected ? '#10b981' : '#ef4444' }]} />
          <Text style={[styles.logoText, { color: colors.text }]}>
            MIKROTIK <Text style={{ color: colors.cyan }}>MULTI-WAN</Text> MANAGER
          </Text>
        </View>

        {/* Row 2: Target Device IP Badge */}
        <View style={[styles.targetBadge, { backgroundColor: isDarkMode ? '#000000' : '#f1f5f9', borderColor: colors.border }]}>
          <Text style={[styles.targetLabel, { color: colors.muted }]}>TARGET IP:</Text>
          <TextInput
            style={[styles.targetInput, { color: colors.text }]}
            value={targetIp}
            onChangeText={setTargetIp}
            placeholder="Detecting IP..."
            placeholderTextColor={colors.muted}
          />
          <TouchableOpacity style={styles.detectBtn} onPress={() => setTargetIp('172.16.10.248')}>
            <Text style={styles.detectBtnText}>Auto Detect</Text>
          </TouchableOpacity>
        </View>

        {/* Row 3: Clock + Action Buttons */}
        <View style={styles.actionRow}>
          <View style={[styles.clockBadge, { backgroundColor: isDarkMode ? '#09090b' : '#f1f5f9', borderColor: colors.border }]}>
            <Text style={[styles.clockText, { color: colors.text }]}>Asia/Manila: 2:26 AM</Text>
          </View>

          <View style={styles.iconButtonsGroup}>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: isDarkMode ? '#1a1a1a' : '#e2e8f0' }]}
              onPress={() => setIsDarkMode(!isDarkMode)}>
              <Text style={{ color: colors.text, fontSize: 14 }}>{isDarkMode ? '☀️' : '🌙'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: isDarkMode ? '#1a1a1a' : '#e2e8f0' }]}
              onPress={() => Alert.alert('Account', 'Log in as Admin')}>
              <Text style={{ color: colors.text, fontSize: 14 }}>👤</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* 1. ROUTER CONNECTION CARD */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>1. Router Connection</Text>
            <View style={[styles.badge, { backgroundColor: isConnected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)' }]}>
              <Text style={{ color: isConnected ? '#10b981' : '#ef4444', fontSize: 10, fontWeight: '700' }}>
                {isConnected ? 'Connected' : 'Disconnected'}
              </Text>
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={[styles.label, { color: colors.muted }]}>Router IP / Host Address</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.border }]}
              value={host}
              onChangeText={setHost}
              placeholder="192.168.88.1"
              placeholderTextColor={colors.muted}
              keyboardType="numeric"
            />
          </View>

          {/* Side-by-side Username & Password */}
          <View style={styles.formRow}>
            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text style={[styles.label, { color: colors.muted }]}>Username</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.border }]}
                value={username}
                onChangeText={setUsername}
                placeholder="admin"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
              />
            </View>
            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text style={[styles.label, { color: colors.muted }]}>Password</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.border }]}
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={colors.muted}
                secureTextEntry
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={[styles.label, { color: colors.muted }]}>API Port (Port 8728)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.border }]}
              value={port}
              onChangeText={setPort}
              placeholder="8728"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
            />
          </View>

          <TouchableOpacity style={styles.connectBtn} onPress={handleConnect}>
            <Text style={styles.connectBtnText}>{isConnected ? 'Re-Connect Router' : 'Connect Router'}</Text>
          </TouchableOpacity>
        </View>

        {/* 2. WAN MANAGEMENT CARD */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>2. WAN Management</Text>
            <View style={[styles.badge, { backgroundColor: 'rgba(0, 242, 254, 0.15)' }]}>
              <Text style={{ color: '#00f2fe', fontSize: 10, fontWeight: '700' }}>{wanList.length} WANs</Text>
            </View>
          </View>
          <Text style={[styles.subtitleText, { color: colors.muted }]}>
            Configure individual WAN interfaces from your MikroTik router.
          </Text>
          <TouchableOpacity style={styles.addWanBtn} onPress={() => Alert.alert('Add WAN', 'Open Interface Selector Modal')}>
            <Text style={styles.addWanBtnText}>+ Add WAN Interface</Text>
          </TouchableOpacity>
        </View>

        {/* 3. CONFIGURED WAN INTERFACES LIST */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Configured WAN Gateways</Text>

        {wanList.map(wan => (
          <View key={wan.name} style={[styles.card, styles.wanCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.wanHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.wanLabel, { color: colors.text }]}>{wan.label}</Text>
                <Text style={[styles.wanDetails, { color: colors.muted }]}>
                  {wan.name} | GW: {wan.gateway}
                </Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: '#10b981' }]}>
                <Text style={styles.statusBadgeText}>{wan.status}</Text>
              </View>
            </View>

            {/* Live SVG Vector Graph Sparkline */}
            <View style={styles.graphContainer}>
              <Svg height="75" width="100%" viewBox="0 0 300 75">
                <Path d="M0 60 Q 75 20, 150 45 T 300 15" fill="none" stroke="#10b981" strokeWidth="2.5" />
                <Path d="M0 70 Q 75 50, 150 65 T 300 40" fill="none" stroke="#00f2fe" strokeWidth="1.5" />
              </Svg>
            </View>

            <View style={styles.legendRow}>
              <Text style={{ color: '#10b981', fontSize: 11, fontWeight: '700' }}>● Tx: {wan.tx}</Text>
              <Text style={{ color: '#00f2fe', fontSize: 11, fontWeight: '700' }}>● Rx: {wan.rx}</Text>
            </View>

            <View style={styles.speedtestRow}>
              <Text style={{ color: colors.muted, fontSize: 11 }}>LAST SPEEDTEST:</Text>
              <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>{wan.lastSpeedtest || 'Not Tested'}</Text>
            </View>

            <TouchableOpacity style={styles.speedtestBtn} onPress={() => Alert.alert('Speed Test', `Running test on ${wan.label}`)}>
              <Text style={styles.speedtestBtnText}>Speed Test</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 10,
    gap: 10,
  },
  header: {
    padding: 10,
    borderBottomWidth: 1,
    gap: 6,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusOrb: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  logoText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  targetBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  targetLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  targetInput: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    padding: 0,
  },
  detectBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  detectBtnText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justify-content: 'space-between',
  },
  clockBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  clockText: {
    fontSize: 10,
    fontWeight: '600',
  },
  iconButtonsGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    alignItems: 'center',
    justify-content: 'center',
  },
  card: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justify-content: 'space-between',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  formGroup: {
    gap: 4,
  },
  formRow: {
    flexDirection: 'row',
    gap: 8,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
  },
  connectBtn: {
    backgroundColor: '#10b981',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  connectBtnText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 13,
  },
  subtitleText: {
    fontSize: 11,
    marginBottom: 4,
  },
  addWanBtn: {
    backgroundColor: '#00f2fe',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  addWanBtnText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 13,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginTop: 6,
  },
  wanCard: {
    gap: 8,
  },
  wanHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justify-content: 'space-between',
  },
  wanLabel: {
    fontSize: 13,
    fontWeight: '800',
  },
  wanDetails: {
    fontSize: 10,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadgeText: {
    color: '#000000',
    fontSize: 9,
    fontWeight: '900',
  },
  graphContainer: {
    backgroundColor: '#05070a',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  legendRow: {
    flexDirection: 'row',
    justify-content: 'space-around',
  },
  speedtestRow: {
    flexDirection: 'row',
    justify-content: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  speedtestBtn: {
    borderWidth: 1,
    borderColor: '#00f2fe',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  speedtestBtnText: {
    color: '#00f2fe',
    fontWeight: '800',
    fontSize: 13,
  },
});
