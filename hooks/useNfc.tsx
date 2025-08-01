import { useCallback } from 'react';
import { Alert } from 'react-native';
import NfcManager, { NfcTech, Ndef } from 'react-native-nfc-manager';
import { groupByPrefix, printStructuredJson } from '../utils/dataUtils';
import Sound from 'react-native-sound';

Sound.setCategory('Playback');

const scanBeep = new Sound('scan_beep.mp3', Sound.MAIN_BUNDLE, (error) => {
  if (error) console.warn('🔇 Failed to load sound', error);
});
const playBeep = () => {
  if (scanBeep && scanBeep.isLoaded()) {
    scanBeep.setVolume(1.0);
    scanBeep.play((success) => {
      if (!success) console.warn('⚠️ Sound playback failed');
    });
  }
};

function handleNfcError(e) {
  if (e instanceof Error && e.message?.toLowerCase().includes('cancel')) {
    console.log('👋 NFC action cancelled by user.');
  } else {
    console.warn('❌ NFC error:', e);
  }
}

export function useNfc({
  onFloatScan,
  onLiveScan,
  setPromptVisible,
  setFormattedFloatData,
  setGraphTitle,
}) {
  const cancelTech = async () => {
    try {
      await NfcManager.cancelTechnologyRequest();
    } catch {}
  };

  const readNfc = useCallback(async () => {
    setPromptVisible(true);

    try {
      await NfcManager.requestTechnology(NfcTech.Ndef);
      const tag = await NfcManager.getTag();
      if (!tag.ndefMessage) return;

      const payload = new Uint8Array(tag.ndefMessage[0].payload);
      const jsonString = String.fromCharCode(...payload);

      let jsonPayload = null;
      try {
        jsonPayload = JSON.parse(jsonString);
      } catch (err) {
        console.error('❌ Failed to parse JSON:', err.message);
        Alert.alert('Data Error', 'Received incomplete or corrupted data. Rescan HTTP data.');
        return;
      }

      printStructuredJson(jsonPayload);

      playBeep();

      const groupedData = { ...jsonPayload };
      if (groupedData.boolean_percentages) {
        groupedData.boolean_percentages = groupByPrefix(groupedData.boolean_percentages);
      }
      if (groupedData.fault_counts) {
        groupedData.fault_counts = groupByPrefix(groupedData.fault_counts);
      }
      if (groupedData.float_averages) {
        const nestedFloats = {};
        Object.entries(groupedData.float_averages).forEach(([key, value]) => {
          const parts = key.split('.');
          if (parts.length !== 3) return;
          const [, group, field] = parts;
          if (!nestedFloats[group]) nestedFloats[group] = {};
          nestedFloats[group][field] = value;
        });
        groupedData.float_averages = nestedFloats;
      }

      onLiveScan(groupedData);
      } catch (e) {
        handleNfcError(e);
      } finally {
      setPromptVisible(false);
      cancelTech();
    }
  }, [onLiveScan, setPromptVisible]);

  const scanFloatTab = useCallback(async () => {
    setPromptVisible(true);
    try {
      await NfcManager.requestTechnology(NfcTech.Ndef);
      const tag = await NfcManager.getTag();
      if (!tag.ndefMessage) return;

      const payload = new Uint8Array(tag.ndefMessage[0].payload);
      const jsonString = String.fromCharCode(...payload);

      const parsedData = JSON.parse(jsonString);
      if (!parsedData.start || !parsedData.interval || !Array.isArray(parsedData.values)) {
        throw new Error('Invalid float format');
      }

      playBeep();

      const startTime = new Date(parsedData.start).getTime();
      const intervalMs = parsedData.interval * 1000;
      const expanded = parsedData.values.map((value, i) => ({
        time: new Date(startTime + i * intervalMs).toISOString(),
        value,
      }));

      onFloatScan(expanded);
      setFormattedFloatData(
        expanded.map(d => ({ ...d, timestamp: new Date(d.time).getTime() }))
      );
    } catch (e) {
      handleNfcError(e);
    } finally {
      setPromptVisible(false);
      cancelTech();
    }
  }, [onFloatScan, setFormattedFloatData, setPromptVisible]);

  const writeNfcFloatRequest = useCallback(async (fieldName, range = '-30m') => {
    const fullFieldName = fieldName.startsWith('Floats.') ? fieldName : `Floats.${fieldName}`;

    const payload = {
      cmd: 'float_range',
      field: fullFieldName,
      start: range,
      stop: 'now()',
    };

    setGraphTitle(fullFieldName);

    try {
      await cancelTech();
      setPromptVisible(true);
      await NfcManager.requestTechnology(NfcTech.Ndef);

      const bytes = Ndef.encodeMessage([
        Ndef.textRecord(JSON.stringify(payload)),
      ]);

      await NfcManager.ndefHandler.writeNdefMessage(bytes);
    } catch (err) {
      console.warn('❌ NFC write error:', err);
    } finally {
      setPromptVisible(false);
      cancelTech();
    }
  }, [setGraphTitle, setPromptVisible]);

  return {
    readNfc,
    scanFloatTab,
    writeNfcFloatRequest,
  };
}
