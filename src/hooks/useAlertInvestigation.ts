import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

export interface UseAlertInvestigationResult {
  error: string | null;
  initialMessage: string | null;
  initialMessageType: 'investigation' | null;
  /** Validated ?skill= param — explicitly activates a skill for the first message. */
  initialSkill: string | null;
  isInvestigationMode: boolean;
}

const ALERT_NAME_MAX_LENGTH = 256;
const XSS_PATTERN = /<script|javascript:|data:/i;
/** Agent Skills spec name rules: lowercase alphanumeric + single hyphens. */
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SKILL_NAME_MAX_LENGTH = 64;

const INACTIVE: UseAlertInvestigationResult = {
  error: null,
  initialMessage: null,
  initialMessageType: null,
  initialSkill: null,
  isInvestigationMode: false,
};

export function useAlertInvestigation(): UseAlertInvestigationResult {
  const location = useLocation();

  return useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    const type = searchParams.get('type');
    const alertName = searchParams.get('alertName');
    const skill = searchParams.get('skill');

    if ((type !== 'investigation' || !alertName) && !skill) {
      return INACTIVE;
    }

    if (alertName && (alertName.length > ALERT_NAME_MAX_LENGTH || XSS_PATTERN.test(alertName))) {
      return {
        error: 'Invalid alert name format',
        initialMessage: null,
        initialMessageType: null,
        initialSkill: null,
        isInvestigationMode: true,
      };
    }

    const initialSkill =
      skill && skill.length <= SKILL_NAME_MAX_LENGTH && SKILL_NAME_PATTERN.test(skill) ? skill : null;

    if (type === 'investigation' && alertName) {
      return {
        error: null,
        initialMessage: `alertName:${alertName}`,
        initialMessageType: 'investigation',
        initialSkill,
        isInvestigationMode: true,
      };
    }

    // ?skill= alone does not auto-send a message; it pre-selects the skill in
    // the picker so the next message the user types activates it.
    return {
      error: null,
      initialMessage: null,
      initialMessageType: null,
      initialSkill,
      isInvestigationMode: false,
    };
  }, [location.search]);
}
