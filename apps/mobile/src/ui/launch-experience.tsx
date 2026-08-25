import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from './theme';

const whaleSource = require('../../assets/brand/dsh-whale.png');

const particles = [
  { left: '16%', top: '28%', size: 3 },
  { left: '77%', top: '24%', size: 2 },
  { left: '84%', top: '47%', size: 4 },
  { left: '12%', top: '56%', size: 2 },
  { left: '24%', top: '72%', size: 3 },
  { left: '72%', top: '70%', size: 2 },
] as const;

export function LaunchExperience({ ready }: { ready: boolean }) {
  const theme = useTheme();
  const [visible, setVisible] = useState(true);
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const coreScale = useRef(new Animated.Value(0.76)).current;
  const coreOpacity = useRef(new Animated.Value(0)).current;
  const copyOpacity = useRef(new Animated.Value(0)).current;
  const copyTranslate = useRef(new Animated.Value(12)).current;
  const ringOne = useRef(new Animated.Value(0)).current;
  const ringTwo = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;
  const twinkle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduceMotion(value);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (reduceMotion === null) return;
    const timer = setTimeout(() => setMinimumElapsed(true), reduceMotion ? 500 : 1750);
    if (reduceMotion) {
      coreScale.setValue(1);
      coreOpacity.setValue(1);
      copyOpacity.setValue(1);
      copyTranslate.setValue(0);
      return () => clearTimeout(timer);
    }

    const intro = Animated.parallel([
      Animated.spring(coreScale, { toValue: 1, damping: 12, stiffness: 90, mass: 0.8, useNativeDriver: true }),
      Animated.timing(coreOpacity, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(620),
        Animated.parallel([
          Animated.timing(copyOpacity, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(copyTranslate, { toValue: 0, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
      ]),
    ]);
    const sonarOne = Animated.loop(Animated.sequence([
      Animated.timing(ringOne, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(ringOne, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    const sonarTwo = Animated.loop(Animated.sequence([
      Animated.delay(650),
      Animated.timing(ringTwo, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(ringTwo, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    const floating = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    const stars = Animated.loop(Animated.sequence([
      Animated.timing(twinkle, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(twinkle, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    intro.start();
    sonarOne.start();
    sonarTwo.start();
    floating.start();
    stars.start();
    return () => {
      clearTimeout(timer);
      intro.stop();
      sonarOne.stop();
      sonarTwo.stop();
      floating.stop();
      stars.stop();
    };
  }, [copyOpacity, copyTranslate, coreOpacity, coreScale, drift, reduceMotion, ringOne, ringTwo, twinkle]);

  useEffect(() => {
    if (!ready || !minimumElapsed || !visible) return;
    Animated.timing(overlayOpacity, {
      toValue: 0,
      duration: reduceMotion ? 160 : 480,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setVisible(false);
    });
  }, [minimumElapsed, overlayOpacity, ready, reduceMotion, visible]);

  if (!visible) return null;
  const ringStyle = (progress: Animated.Value) => ({
    opacity: progress.interpolate({ inputRange: [0, 0.18, 1], outputRange: [0, 0.45, 0] }),
    transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1.7] }) }],
  });

  return <Animated.View pointerEvents="none" accessibilityLabel="DeepSeek Harness is starting" style={[styles.overlay, { backgroundColor: theme.colors.background, opacity: overlayOpacity }]}> 
    <View style={[styles.axis, styles.axisHorizontal, { backgroundColor: theme.colors.line }]} />
    <View style={[styles.axis, styles.axisVertical, { backgroundColor: theme.colors.line }]} />
    {particles.map((particle, index) => <Animated.View key={`${particle.left}:${particle.top}`} style={[styles.particle, {
      left: particle.left,
      top: particle.top,
      width: particle.size,
      height: particle.size,
      borderRadius: particle.size,
      backgroundColor: index % 2 ? theme.colors.accent : theme.colors.faint,
      opacity: twinkle.interpolate({ inputRange: [0, 1], outputRange: [index % 2 ? 0.18 : 0.45, index % 2 ? 0.7 : 0.2] }),
    }]} />)}
    <View style={styles.signalField}>
      <Animated.View style={[styles.ring, { borderColor: theme.colors.accent }, ringStyle(ringOne)]} />
      <Animated.View style={[styles.ring, { borderColor: theme.colors.accent }, ringStyle(ringTwo)]} />
      <Animated.View style={{ opacity: coreOpacity, transform: [{ translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [2, -4] }) }, { scale: coreScale }] }}>
        <View style={[styles.coreGlow, { backgroundColor: theme.colors.accent }]} />
        <View style={styles.whaleCore}>
          <Image source={whaleSource} resizeMode="contain" style={styles.whale} />
        </View>
      </Animated.View>
    </View>
    <Animated.View style={[styles.copy, { opacity: copyOpacity, transform: [{ translateY: copyTranslate }] }]}> 
      <Text style={[styles.kicker, { color: theme.colors.accent }]}>DEEPSEEK HARNESS</Text>
      <Text style={[styles.tagline, { color: theme.colors.text }]}>探索未至之境</Text>
      <View style={styles.signalLine}><View style={[styles.signalDash, { backgroundColor: theme.colors.line }]} /><View style={[styles.signalDot, { backgroundColor: theme.colors.accent }]} /><View style={[styles.signalDash, { backgroundColor: theme.colors.line }]} /></View>
    </Animated.View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  axis: { position: 'absolute', opacity: 0.22 },
  axisHorizontal: { left: '10%', right: '10%', top: '48%', height: StyleSheet.hairlineWidth },
  axisVertical: { top: '18%', bottom: '18%', left: '50%', width: StyleSheet.hairlineWidth },
  particle: { position: 'absolute' },
  signalField: { width: 250, height: 250, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 178, height: 178, borderRadius: 89, borderWidth: StyleSheet.hairlineWidth },
  coreGlow: { position: 'absolute', width: 126, height: 126, borderRadius: 63, opacity: 0.14, transform: [{ scale: 1.18 }] },
  whaleCore: { width: 126, height: 126, borderRadius: 63, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F8FA', borderWidth: StyleSheet.hairlineWidth, borderColor: '#D9DDE5', shadowColor: '#4D6BFE', shadowOpacity: 0.22, shadowRadius: 26, shadowOffset: { width: 0, height: 10 }, elevation: 12 },
  whale: { width: 91, height: 91 },
  copy: { marginTop: 28, alignItems: 'center' },
  kicker: { fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 2.4 },
  tagline: { marginTop: 13, fontSize: 24, lineHeight: 34, fontWeight: '600', letterSpacing: 5 },
  signalLine: { marginTop: 22, flexDirection: 'row', alignItems: 'center', gap: 7 },
  signalDash: { width: 34, height: StyleSheet.hairlineWidth },
  signalDot: { width: 4, height: 4, borderRadius: 2 },
});
