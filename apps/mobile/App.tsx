import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { isVisionAvailable } from './src/native/vision';
import {
  countPhotos,
  requestPhotoAccess,
  scanPhotos,
  type PhotoCandidate,
  type ScanProgress,
} from './src/photos/photo-scan';
import {
  uploadCandidates,
  type UploadProgress,
} from './src/sync/upload';

type BusyState = 'idle' | 'counting' | 'scanning' | 'uploading';

export default function App() {
  const defaults = useMemo(() => defaultDateRange(), []);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [serverUrl, setServerUrl] = useState('');
  const [photoCount, setPhotoCount] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<PhotoCandidate[]>([]);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(
    null,
  );
  const [busy, setBusy] = useState<BusyState>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const visionAvailable = isVisionAvailable();

  async function handleCount() {
    try {
      setBusy('counting');
      setMessage(null);
      const { start, endExclusive } = parseRange(startDate, endDate);
      const permission = await requestPhotoAccess();
      if (!permission.granted) {
        throw new Error('사진 보관함 전체 접근 권한이 필요합니다.');
      }

      const count = await countPhotos(start, endExclusive);
      setPhotoCount(count);
      setMessage(
        permission.accessPrivileges === 'limited'
          ? '현재 일부 사진만 접근 가능함. iOS 설정에서 전체 사진 접근을 허용해야 정확합니다.'
          : null,
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy('idle');
    }
  }

  async function handleScan() {
    if (!visionAvailable) {
      setMessage(
        'Expo Go에서는 온디바이스 Vision 분류기를 쓸 수 없음. README의 development build 절차로 설치한 뒤 실행해야 합니다.',
      );
      return;
    }

    try {
      setBusy('scanning');
      setMessage(null);
      setCandidates([]);
      setUploadProgress(null);
      const { start, endExclusive } = parseRange(startDate, endDate);
      const permission = await requestPhotoAccess();
      if (!permission.granted || permission.accessPrivileges === 'limited') {
        throw new Error('분석하려면 iOS 사진 보관함 전체 접근 권한이 필요합니다.');
      }

      const result = await scanPhotos(start, endExclusive, setScanProgress);
      setCandidates(result.candidates);
      setPhotoCount(result.progress.total);
      setMessage(
        `분석 완료: ${result.progress.total}장 중 POI 후보 ${result.progress.candidates}장`,
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy('idle');
    }
  }

  async function handleUpload() {
    if (candidates.length === 0) {
      setMessage('먼저 POI 후보 분석을 실행해 주세요.');
      return;
    }

    try {
      setBusy('uploading');
      setMessage(null);
      const result = await uploadCandidates(
        serverUrl,
        candidates,
        setUploadProgress,
      );
      setMessage(
        `전송 완료: 추가 ${result.imported} · 중복 ${result.skipped} · 실패 ${result.failed}`,
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy('idle');
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Michikusa Sync</Text>
          <Text style={styles.subtitle}>
            기간 선택 → iPhone에서 POI 후보 분석 → 같은 Wi-Fi의 PC로 전송
          </Text>
        </View>

        <Section title="1. 기간">
          <View style={styles.row}>
            <DateInput
              label="시작"
              value={startDate}
              onChangeText={setStartDate}
            />
            <DateInput label="끝" value={endDate} onChangeText={setEndDate} />
          </View>
          <ActionButton
            title={
              busy === 'counting' ? '사진 수 확인 중…' : '기간 사진 수 확인'
            }
            onPress={handleCount}
            disabled={busy !== 'idle'}
          />
          {photoCount !== null && (
            <Text style={styles.metric}>사진 {photoCount.toLocaleString()}장</Text>
          )}
        </Section>

        <Section title="2. 온디바이스 POI 분석">
          <Text style={styles.helper}>
            Apple Vision이 사진을 기기 안에서 분류합니다. 음식뿐 아니라 식당,
            랜드마크, 숙박, 교통, 자연, 거리 후보를 남깁니다.
          </Text>
          <Text style={styles.helper}>
            Vision 모듈: {visionAvailable ? '사용 가능' : 'development build 필요'}
          </Text>
          <ActionButton
            title={busy === 'scanning' ? '분석 중…' : 'POI 후보 분석 시작'}
            onPress={handleScan}
            disabled={busy !== 'idle'}
          />
          {scanProgress && (
            <View style={styles.stats}>
              <Text>
                {scanProgress.processed.toLocaleString()} /{' '}
                {scanProgress.total.toLocaleString()}
              </Text>
              <Text>후보 {scanProgress.candidates.toLocaleString()}</Text>
              <Text>실패 {scanProgress.failed.toLocaleString()}</Text>
            </View>
          )}
        </Section>

        <Section title="3. PC로 전송">
          <TextInput
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="http://192.168.0.10:4000"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.serverInput}
          />
          <Text style={styles.helper}>
            PC와 iPhone을 같은 Wi-Fi에 두고 PC의 IPv4 주소를 입력합니다.
          </Text>
          <ActionButton
            title={
              busy === 'uploading'
                ? '전송 중…'
                : `후보 ${candidates.length.toLocaleString()}장 전송`
            }
            onPress={handleUpload}
            disabled={busy !== 'idle' || candidates.length === 0}
          />
          {uploadProgress && (
            <View style={styles.stats}>
              <Text>
                {uploadProgress.processed.toLocaleString()} /{' '}
                {uploadProgress.total.toLocaleString()}
              </Text>
              <Text>추가 {uploadProgress.imported.toLocaleString()}</Text>
              <Text>중복 {uploadProgress.skipped.toLocaleString()}</Text>
              <Text>실패 {uploadProgress.failed.toLocaleString()}</Text>
            </View>
          )}
        </Section>

        {busy !== 'idle' && <ActivityIndicator size="small" />}

        {message && <Text style={styles.message}>{message}</Text>}

        {candidates.length > 0 && (
          <Section title="후보 미리보기">
            {candidates.slice(0, 20).map((candidate) => (
              <View key={candidate.assetId} style={styles.candidateRow}>
                <View style={styles.candidateText}>
                  <Text numberOfLines={1} style={styles.filename}>
                    {candidate.filename}
                  </Text>
                  <Text style={styles.helper}>
                    {candidate.category} ·{' '}
                    {candidate.labels[0]?.identifier ?? 'label 없음'}
                  </Text>
                </View>
                <Text style={styles.time}>
                  {formatCapturedAt(candidate.capturedAt)}
                </Text>
              </View>
            ))}
            {candidates.length > 20 && (
              <Text style={styles.helper}>
                외 {(candidates.length - 20).toLocaleString()}장
              </Text>
            )}
          </Section>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function DateInput({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.dateInputWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        style={styles.input}
      />
    </View>
  );
}

function ActionButton({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  return {
    start: formatDate(start),
    end: formatDate(end),
  };
}

function parseRange(startText: string, endText: string) {
  const start = parseLocalDate(startText);
  const end = parseLocalDate(endText);
  if (end < start) throw new Error('끝 날짜가 시작 날짜보다 빠릅니다.');

  const endExclusive = new Date(end);
  endExclusive.setDate(endExclusive.getDate() + 1);
  return { start, endExclusive };
}

function parseLocalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('날짜는 YYYY-MM-DD 형식으로 입력해 주세요.');
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error('유효하지 않은 날짜입니다.');
  }
  return date;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatCapturedAt(value: string) {
  const date = new Date(value);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(
    date.getDate(),
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4f4f1',
  },
  container: {
    padding: 18,
    gap: 14,
  },
  header: {
    gap: 4,
    marginBottom: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    color: '#666',
    lineHeight: 20,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  dateInputWrap: {
    flex: 1,
    gap: 5,
  },
  label: {
    fontSize: 12,
    color: '#666',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 15,
  },
  serverInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
  },
  button: {
    backgroundColor: '#171717',
    borderRadius: 9,
    paddingVertical: 11,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
  },
  helper: {
    color: '#666',
    fontSize: 13,
    lineHeight: 18,
  },
  metric: {
    fontSize: 20,
    fontWeight: '700',
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  message: {
    backgroundColor: '#fffbe6',
    borderRadius: 10,
    padding: 12,
    lineHeight: 19,
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  candidateText: {
    flex: 1,
  },
  filename: {
    fontWeight: '600',
  },
  time: {
    fontSize: 12,
    color: '#777',
  },
});
