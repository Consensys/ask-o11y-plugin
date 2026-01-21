import React, { useState, useEffect } from 'react';
// Note: Select is deprecated but used for compatibility. Consider migrating to Combobox in future.
 
import { Modal, Button, Select, Input, ClipboardButton } from '@grafana/ui';
import { sessionShareService, CreateShareResponse } from '../../../../services/sessionShare';
import { ChatSession } from '../../../../core/models/ChatSession';

interface ShareDialogProps {
  sessionId: string;
  session: ChatSession;
  onClose: () => void;
  existingShares?: CreateShareResponse[];
}

export function ShareDialog({ sessionId, session, onClose, existingShares = [] }: ShareDialogProps) {
  // Default to 7 days (encoded as 107)
  const [expiresInDays, setExpiresInDays] = useState<number | undefined>(107);
  const [isCreating, setIsCreating] = useState(false);
  const [createdShare, setCreatedShare] = useState<CreateShareResponse | null>(null);
  const [shares, setShares] = useState<CreateShareResponse[]>(existingShares);
  const [revokingShareId, setRevokingShareId] = useState<string | null>(null);

  useEffect(() => {
    // Load existing shares if not provided
    if (existingShares.length === 0) {
      loadShares();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, existingShares.length]);

  const loadShares = async () => {
    try {
      const loadedShares = await sessionShareService.getSessionShares(sessionId);
      setShares(loadedShares);
    } catch (error) {
      console.error('[ShareDialog] Failed to load shares:', error);
    }
  };

  const handleCreateShare = async () => {
    setIsCreating(true);
    try {
      // Decode the encoded value:
      // -1: Never (send undefined)
      // 1-23: Hours (send as ExpiresInHours)
      // 100+: Days (send as ExpiresInDays, value - 100 = actual days)
      let expiresInDaysValue: number | undefined = undefined;
      let expiresInHoursValue: number | undefined = undefined;
      
      if (expiresInDays === -1) {
        // Never - send nothing
        expiresInDaysValue = undefined;
        expiresInHoursValue = undefined;
      } else if (expiresInDays !== undefined && expiresInDays < 100) {
        // Hours (1-23)
        expiresInHoursValue = expiresInDays;
      } else if (expiresInDays !== undefined && expiresInDays >= 100) {
        // Days (100+), decode: value - 100 = actual days
        expiresInDaysValue = expiresInDays - 100;
      }
      
      const share = await sessionShareService.createShare(
        sessionId,
        session,
        expiresInDaysValue,
        expiresInHoursValue
      );
      setCreatedShare(share);
      await loadShares(); // Refresh shares list
    } catch (error) {
      console.error('[ShareDialog] Failed to create share:', error);
      alert('Failed to create share. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevokeShare = async (shareId: string) => {
    setRevokingShareId(shareId);
    try {
      await sessionShareService.revokeShare(shareId);
      setShares(shares.filter((s) => s.shareId !== shareId));
      if (createdShare?.shareId === shareId) {
        setCreatedShare(null);
      }
    } catch (error) {
      console.error('[ShareDialog] Failed to revoke share:', error);
      alert('Failed to revoke share. Please try again.');
    } finally {
      setRevokingShareId(null);
    }
  };

  const formatExpiryDate = (expiresAt: string | null): string => {
    if (!expiresAt) {
      return 'Never';
    }
    try {
      const date = new Date(expiresAt);
      return date.toLocaleDateString();
    } catch {
      return 'Invalid date';
    }
  };

  // Options use special encoding:
  // Values 1-23: hours (sent as ExpiresInHours)
  // Values 100+: days (sent as ExpiresInDays, value - 100 = actual days)
  // Value -1: Never (sent as undefined)
  const expiryOptions = [
    { label: '1 hour', value: 1 }, // Sent as ExpiresInHours: 1
    { label: '1 day', value: 101 }, // Sent as ExpiresInDays: 1 (101 - 100)
    { label: '7 days', value: 107 }, // Sent as ExpiresInDays: 7 (107 - 100) - default
    { label: '30 days', value: 130 }, // Sent as ExpiresInDays: 30 (130 - 100)
    { label: '90 days', value: 190 }, // Sent as ExpiresInDays: 90 (190 - 100)
    { label: 'Never', value: -1 }, // Sent as undefined
  ];

  return (
    <Modal title="Share Session" isOpen={true} onDismiss={onClose}>
      <div className="min-w-[400px]">
        {createdShare ? (
          <div className="space-y-3">
            <p className="text-sm text-primary">Share link created successfully!</p>
            <div>
              <label className="block text-xs font-medium mb-1 text-primary">Share URL:</label>
              <div className="flex gap-1.5">
                <Input
                  data-testid="share-url-input"
                  value={sessionShareService.buildShareUrl(createdShare.shareId)}
                  readOnly
                  className="flex-1"
                />
                <ClipboardButton
                  icon="copy"
                  getText={() => sessionShareService.buildShareUrl(createdShare.shareId)}
                >
                  Copy
                </ClipboardButton>
              </div>
            </div>
            <div className="text-xs text-secondary">
              <strong>Expires:</strong> {formatExpiryDate(createdShare.expiresAt)}
            </div>
            <div className="flex gap-1.5 justify-end pt-2">
              <Button variant="secondary" size="sm" onClick={() => setCreatedShare(null)}>
                Create Another Share
              </Button>
              <Button variant="primary" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1 text-primary">
                Expiration:
              </label>
              <Select
                data-testid="expiry-select"
                options={expiryOptions.map((opt) => ({ label: opt.label, value: opt.value }))}
                value={expiresInDays !== undefined ? expiresInDays : -1}
                onChange={(option) => {
                  if (option) {
                    const val = option.value as number;
                    // -1 is the sentinel value for "Never"
                    setExpiresInDays(val === -1 ? undefined : val);
                  }
                }}
                placeholder="Select expiration"
              />
            </div>

            <div className="p-2 bg-secondary rounded text-xs text-secondary">
              <p className="m-0">
                Shared sessions can be viewed in read-only mode. Recipients can import the session to their account.
              </p>
            </div>

            {shares.length > 0 && (
              <div>
                <label className="block text-xs font-medium mb-1 text-primary">
                  Existing Shares:
                </label>
                <div className="flex flex-col gap-1.5">
                  {shares.map((share) => (
                    <div
                      key={share.shareId}
                      className="flex justify-between items-center p-1.5 bg-secondary rounded border border-weak"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-secondary overflow-hidden text-ellipsis">
                          {share.shareUrl}
                        </div>
                        <div className="text-xs text-disabled mt-0.5">
                          Expires: {formatExpiryDate(share.expiresAt)}
                        </div>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleRevokeShare(share.shareId)}
                        disabled={revokingShareId === share.shareId}
                      >
                        {revokingShareId === share.shareId ? 'Revoking...' : 'Revoke'}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-1.5 justify-end pt-2">
              <Button variant="secondary" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleCreateShare} disabled={isCreating}>
                {isCreating ? 'Creating...' : 'Create Share'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
