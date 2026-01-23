import React, { useState, useEffect } from 'react';
// Note: Select is deprecated but used for compatibility. Consider migrating to Combobox in future.

import { Modal, Button, Select, Input, ClipboardButton } from '@grafana/ui';
import { sessionShareService, CreateShareResponse } from '../../../../services/sessionShare';
import { ChatSession } from '../../../../core/models/ChatSession';
import {
  EXPIRY_OPTIONS,
  expiryConfigToApiParams,
  formatExpiryDate,
  expiryConfigToKey,
  findExpiryOptionByKey,
} from '../../../../utils/shareUtils';

interface ShareDialogProps {
  sessionId: string;
  session: ChatSession;
  onClose: () => void;
  existingShares?: CreateShareResponse[];
  onSharesChanged?: (shares: CreateShareResponse[]) => void;
}

export function ShareDialog({ sessionId, session, onClose, existingShares = [], onSharesChanged }: ShareDialogProps) {
  // Default to 7 days
  const [selectedExpiryKey, setSelectedExpiryKey] = useState<string>(expiryConfigToKey({ type: 'days', value: 7 }));
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
      onSharesChanged?.(loadedShares);
    } catch (error) {
      console.error('[ShareDialog] Failed to load shares:', error);
    }
  };

  const handleCreateShare = async () => {
    setIsCreating(true);
    try {
      const expiryOption = findExpiryOptionByKey(selectedExpiryKey);
      if (!expiryOption) {
        console.error('[ShareDialog] Invalid expiry option selected');
        return;
      }

      const { expiresInDays, expiresInHours } = expiryConfigToApiParams(expiryOption.config);

      const share = await sessionShareService.createShare(
        sessionId,
        session,
        expiresInDays,
        expiresInHours
      );
      setCreatedShare(share);

      // Update shares list locally and notify parent
      const updatedShares = [...shares, share];
      setShares(updatedShares);
      onSharesChanged?.(updatedShares);
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
      const updatedShares = shares.filter((s) => s.shareId !== shareId);
      setShares(updatedShares);
      onSharesChanged?.(updatedShares);
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
                  value={sessionShareService.buildShareUrl(createdShare.shareUrl)}
                  readOnly
                  className="flex-1"
                />
                <ClipboardButton
                  icon="copy"
                  getText={() => sessionShareService.buildShareUrl(createdShare.shareUrl)}
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
                options={EXPIRY_OPTIONS.map((opt) => ({
                  label: opt.label,
                  value: expiryConfigToKey(opt.config),
                }))}
                value={selectedExpiryKey}
                onChange={(option) => {
                  if (option) {
                    setSelectedExpiryKey(option.value as string);
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
