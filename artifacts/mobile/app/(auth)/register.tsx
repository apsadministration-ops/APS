import { View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { Link } from "expo-router";
import { useState } from "react";
import { useRegister, useRegisterBusiness, RegisterBodyRole } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { alertMessage } from "@/utils/confirm";
import { Feather } from "@expo/vector-icons";
import { PARTNER_LAYER_LABEL, PARTNER_LAYER_DESCRIPTION } from "@/lib/partnerIdentity";
import {
  BUSINESS_REGISTRATION_OPTIONS,
  buildBusinessRegistrationPayload,
  type BusinessRegistrationSubtype,
} from "@/lib/businessAccount";

const RADIUS_OPTIONS = [5, 10, 25, 50, 100];

const ROLE_OPTIONS: ReadonlyArray<{
  role: RegisterBodyRole;
  label: string;
  businessSubtype?: BusinessRegistrationSubtype;
}> = [
  { role: "customer", label: "Customer" },
  { role: "mechanic", label: "Mechanic" },
  { role: "shop_owner", label: "Shop / Repair Facility", businessSubtype: "shop" },
  { role: "shop_owner", label: "Dealership", businessSubtype: "dealership" },
  { role: "shop_owner", label: "Fleet / Commercial Fleet", businessSubtype: "fleet" },
];

interface VerifiedLocation {
  lat: number;
  lng: number;
  city: string;
  region: string;
  zipCode: string;
  displayName: string;
}

export default function RegisterScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RegisterBodyRole>("customer");
  const [lastIndividualRole, setLastIndividualRole] = useState<"customer" | "mechanic">("customer");
  const [businessSubtype, setBusinessSubtype] = useState<BusinessRegistrationSubtype | null>(null);
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [serviceRadius, setServiceRadius] = useState(25);
  const [verified, setVerified] = useState<VerifiedLocation | null>(null);
  const [manualAddress, setManualAddress] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const registerMutation = useRegister();
  const registerBusinessMutation = useRegisterBusiness();
  const { login } = useAuth();
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const fullAddressInput = [address, city, region, zipCode].filter(Boolean).join(", ");

  const selectRole = (nextRole: RegisterBodyRole, nextSubtype?: BusinessRegistrationSubtype) => {
    setRole(nextRole);
    setBusinessSubtype(nextSubtype ?? null);
    if (!nextSubtype && (nextRole === "customer" || nextRole === "mechanic")) {
      setLastIndividualRole(nextRole);
    }
  };

  // Reset verification on any address-field change
  const onAddressChange = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    if (verified || manualAddress) {
      setVerified(null);
      setManualAddress(false);
    }
  };

  const verifyLocation = async () => {
    if (!address.trim() || !zipCode.trim()) {
      setVerifyError("Enter at least street address and ZIP code first.");
      return;
    }
    setVerifying(true);
    setVerifyError(null);
    setManualAddress(false);
    try {
      const q = encodeURIComponent(`${address}, ${city}, ${region} ${zipCode}, USA`);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${q}`,
        { headers: { "Accept-Language": "en" }, signal: ctrl.signal },
      );
      clearTimeout(t);
      if (!res.ok) {
        setVerifyError("Address lookup is temporarily unavailable. Please try again in a moment.");
        return;
      }
      const raw: unknown = await res.json().catch(() => null);
      const arr = Array.isArray(raw) ? raw as Array<{
        lat?: string; lon?: string; display_name?: string;
        address?: { city?: string; town?: string; village?: string; state?: string; postcode?: string };
      }> : [];
      if (!arr.length || !arr[0].lat || !arr[0].lon) {
        setVerifyError("Could not find that address. Please double-check it.");
        return;
      }
      const hit = arr[0];
      const lat = parseFloat(hit.lat!);
      const lng = parseFloat(hit.lon!);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        setVerifyError("Could not understand that address. Please double-check it.");
        return;
      }
      const v: VerifiedLocation = {
        lat, lng,
        city: hit.address?.city || hit.address?.town || hit.address?.village || city,
        region: hit.address?.state || region,
        zipCode: hit.address?.postcode || zipCode,
        displayName: hit.display_name || `${address}, ${city}, ${region} ${zipCode}`,
      };
      setVerified(v);
      // Back-fill confirmed values
      if (v.city && !city) setCity(v.city);
      if (v.region && !region) setRegion(v.region);
      if (v.zipCode && v.zipCode !== zipCode) setZipCode(v.zipCode);
    } catch {
      setVerifyError("Couldn't reach the address lookup service. Try again.");
    } finally {
      setVerifying(false);
    }
  };

  const continueWithManualAddress = () => {
    if (!address.trim() || !city.trim() || !region.trim() || !zipCode.trim()) {
      setVerifyError("Enter street address, city, state, and ZIP code before continuing.");
      return;
    }
    setVerified(null);
    setManualAddress(true);
    setVerifyError(null);
  };

  const handleRegister = () => {
    if (!email || !password || !name) {
      alertMessage("Missing info", "Please fill in name, email and password.");
      return;
    }
    if (!address.trim() || !city.trim() || !region.trim() || !zipCode.trim()) {
      alertMessage("Address required", "Please enter your full home address.");
      return;
    }
    if (!verified && !manualAddress) {
      alertMessage(
        "Address verification needed",
        "Verify the address, or choose “Continue with typed address” if the lookup service is unavailable.",
      );
      return;
    }
    const typedAddress = {
      address: address.trim(),
      city: city.trim(),
      region: region.trim(),
      zipCode: zipCode.trim(),
    };
    registerMutation.mutate(
      {
        data: {
          name,
          email,
          password,
          role,
          phone: phone || undefined,
          ...typedAddress,
          ...(verified
            ? { homeLat: verified.lat, homeLng: verified.lng }
            : {}),
          ...(role === "mechanic" ? { serviceRadiusMiles: serviceRadius } : {}),
        },
      },
      {
        onSuccess: async (data) => { await login(data.user, data.token); },
        onError: (err) => { console.error("Registration failed", err); },
      },
    );
  };

  if (businessSubtype) {
    return (
      <BusinessRegistrationForm
        subtype={businessSubtype}
        onSubtypeChange={setBusinessSubtype}
        onBack={() => selectRole(lastIndividualRole)}
        registerMutation={registerBusinessMutation}
        login={login}
        insets={insets}
        colors={colors}
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{
          paddingTop: insets.top + 32,
          paddingBottom: insets.bottom + 40,
          paddingHorizontal: 24,
        }}
        bottomOffset={20}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground }]}>Create Account</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Join APS today</Text>
        </View>

        <View style={styles.form}>
          <Text style={[styles.label, { color: colors.foreground }]}>I am a...</Text>
          <View style={styles.roleContainer}>
            {ROLE_OPTIONS.map((option) => {
              const selected = role === option.role && option.businessSubtype == null;
              return (
                <Pressable
                  key={option.label}
                  testID={`role-option-${option.businessSubtype ?? option.role}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[
                    styles.roleButton,
                    {
                      backgroundColor: selected ? colors.primary : colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => selectRole(option.role, option.businessSubtype)}
                >
                  <Text
                    style={[
                      styles.roleText,
                      {
                        textAlign: "center",
                        color: selected ? colors.primaryForeground : colors.foreground,
                      },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {role === "shop_owner" && (
            <Text style={{ color: colors.mutedForeground }}>{PARTNER_LAYER_DESCRIPTION}</Text>
          )}

          <Text style={[styles.label, { color: colors.foreground }]}>Full Name</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
            placeholder="John Doe"
            placeholderTextColor={colors.mutedForeground}
            value={name}
            onChangeText={setName}
          />

          <Text style={[styles.label, { color: colors.foreground }]}>Email</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
            placeholder="john@example.com"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />

          <Text style={[styles.label, { color: colors.foreground }]}>Phone (optional)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
            placeholder="(555) 555-1234"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
          />

          <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
            placeholder="Create a secure password"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <View style={[styles.sectionDivider, { borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Home Address</Text>
            <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>
              {role === "mechanic"
                ? "We use this to find jobs in your service area."
                : "We use this to match you with nearby mechanics."}
            </Text>
          </View>

          <Text style={[styles.label, { color: colors.foreground }]}>Street Address</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
            placeholder="123 Main St"
            placeholderTextColor={colors.mutedForeground}
            value={address}
            onChangeText={onAddressChange(setAddress)}
          />

          <View style={styles.row}>
            <View style={{ flex: 2 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>City</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
                placeholder="Austin"
                placeholderTextColor={colors.mutedForeground}
                value={city}
                onChangeText={onAddressChange(setCity)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>State</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
                placeholder="TX"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="characters"
                value={region}
                onChangeText={onAddressChange(setRegion)}
              />
            </View>
          </View>

          <Text style={[styles.label, { color: colors.foreground }]}>ZIP Code</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
            placeholder="78701"
            placeholderTextColor={colors.mutedForeground}
            keyboardType={Platform.OS === "web" ? "default" : "number-pad"}
            value={zipCode}
            onChangeText={onAddressChange(setZipCode)}
          />

          <Pressable
            style={[
              styles.verifyBtn,
              {
                backgroundColor: verified ? colors.primary + "22" : colors.secondary,
                borderColor: verified ? colors.primary : colors.border,
              },
              verifying && { opacity: 0.6 },
            ]}
            onPress={verifyLocation}
            disabled={verifying}
          >
            {verifying ? (
              <ActivityIndicator color={colors.primary} />
            ) : verified ? (
              <>
                <Feather name="check-circle" size={16} color={colors.primary} />
                <Text style={[styles.verifyText, { color: colors.primary }]}>Address Verified</Text>
              </>
            ) : (
              <>
                <Feather name="map-pin" size={16} color={colors.foreground} />
                <Text style={[styles.verifyText, { color: colors.foreground }]}>Verify Address</Text>
              </>
            )}
          </Pressable>

          {verifyError && (
            <Text style={[styles.error, { color: colors.destructive }]}>{verifyError}</Text>
          )}
          {verifyError && !manualAddress && !verifying &&
            address.trim() && city.trim() && region.trim() && zipCode.trim() ? (
            <Pressable
              style={[
                styles.manualAddressBtn,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={continueWithManualAddress}
            >
              <Feather name="edit-3" size={16} color={colors.foreground} />
              <Text style={[styles.verifyText, { color: colors.foreground }]}>
                Continue with typed address
              </Text>
            </Pressable>
          ) : null}
          {verified && (
            <Text style={[styles.verifiedAddress, { color: colors.mutedForeground }]} numberOfLines={2}>
              {verified.displayName}
            </Text>
          )}
          {manualAddress && (
            <View
              style={[
                styles.manualAddressNotice,
                { backgroundColor: colors.secondary, borderColor: colors.border },
              ]}
            >
              <Feather name="info" size={16} color={colors.foreground} />
              <Text style={[styles.manualAddressText, { color: colors.foreground }]}>
                Address will be saved as entered. Location is unverified and no coordinates will be stored.
                {role === "mechanic"
                  ? " Mechanic coverage may be limited until the address can be verified."
                  : ""}
              </Text>
            </View>
          )}

          {role === "mechanic" && (
            <>
              <View style={[styles.sectionDivider, { borderColor: colors.border }]}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Service Radius</Text>
                <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>
                  How far are you willing to travel for a job?
                </Text>
              </View>
              <View style={styles.radiusRow}>
                {RADIUS_OPTIONS.map((mi) => {
                  const sel = serviceRadius === mi;
                  return (
                    <Pressable
                      key={mi}
                      style={[
                        styles.radiusChip,
                        {
                          backgroundColor: sel ? colors.primary : colors.card,
                          borderColor: sel ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setServiceRadius(mi)}
                    >
                      <Text style={[styles.radiusChipText, { color: sel ? colors.primaryForeground : colors.foreground }]}>
                        {mi} mi
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {registerMutation.isError && (
            <Text style={[styles.error, { color: colors.destructive }]}>
              {registerMutation.error?.message || "Registration failed. Please try again."}
            </Text>
          )}

          <Pressable
            style={[styles.button, { backgroundColor: colors.primary }, registerMutation.isPending && { opacity: 0.6 }]}
            onPress={handleRegister}
            disabled={registerMutation.isPending}
          >
            {registerMutation.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Sign Up</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>Already have an account?</Text>
          <Link href="/(auth)/login" asChild>
            <Pressable>
              <Text style={[styles.link, { color: colors.primary }]}>Sign In</Text>
            </Pressable>
          </Link>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

type BusinessRegistrationFormProps = {
  subtype: BusinessRegistrationSubtype;
  onSubtypeChange: (subtype: BusinessRegistrationSubtype) => void;
  onBack: () => void;
  registerMutation: ReturnType<typeof useRegisterBusiness>;
  login: ReturnType<typeof useAuth>["login"];
  insets: ReturnType<typeof useSafeAreaInsets>;
  colors: ReturnType<typeof useColors>;
};

function BusinessRegistrationForm({
  subtype,
  onSubtypeChange,
  onBack,
  registerMutation,
  login,
  insets,
  colors,
}: BusinessRegistrationFormProps) {
  const [legalName, setLegalName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [administratorName, setAdministratorName] = useState("");
  const [administratorEmail, setAdministratorEmail] = useState("");
  const [administratorPhone, setAdministratorPhone] = useState("");
  const [administratorPassword, setAdministratorPassword] = useState("");
  const [addressVerified, setAddressVerified] = useState(false);
  const [verifyingAddress, setVerifyingAddress] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);

  const verifyBusinessAddress = async () => {
    if (!address.trim() || !city.trim() || !region.trim() || !zipCode.trim()) {
      setAddressError("Enter the business street address, city, region, and ZIP first.");
      return;
    }
    setVerifyingAddress(true);
    setAddressError(null);
    try {
      const query = encodeURIComponent(`${address}, ${city}, ${region} ${zipCode}, USA`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${query}`,
        { headers: { "Accept-Language": "en" }, signal: controller.signal },
      );
      clearTimeout(timeout);
      if (!response.ok) {
        setAddressError("Address lookup is temporarily unavailable. Please try again.");
        return;
      }
      const result: unknown = await response.json().catch(() => null);
      if (!Array.isArray(result) || !result[0]?.lat || !result[0]?.lon) {
        setAddressError("Could not find that business address. Please double-check it.");
        return;
      }
      const hit = result[0] as {
        address?: {
          city?: string;
          town?: string;
          village?: string;
          state?: string;
          postcode?: string;
        };
      };
      if (hit.address?.city || hit.address?.town || hit.address?.village) {
        setCity(hit.address.city || hit.address.town || hit.address.village || city);
      }
      if (hit.address?.state) setRegion(hit.address.state);
      if (hit.address?.postcode) setZipCode(hit.address.postcode);
      setAddressVerified(true);
    } catch {
      setAddressError("Could not reach the address lookup service. Try again.");
    } finally {
      setVerifyingAddress(false);
    }
  };

  const handleSubmit = () => {
    setFormError(null);
    if (
      !legalName.trim() ||
      !businessEmail.trim() ||
      !businessPhone.trim() ||
      !address.trim() ||
      !city.trim() ||
      !region.trim() ||
      !zipCode.trim()
    ) {
      setFormError("Complete the business name, contact, and address fields.");
      return;
    }
    if (!addressVerified) {
      setFormError("Verify the business address before continuing.");
      return;
    }
    if (!administratorName.trim() || !administratorEmail.trim() || !administratorPassword) {
      setFormError("Complete the primary owner/admin account fields.");
      return;
    }

    const payload = buildBusinessRegistrationPayload({
      legalName,
      displayName,
      subtype,
      businessEmail,
      businessPhone,
      address,
      city,
      region,
      zipCode,
      administratorName,
      administratorEmail,
      administratorPhone,
      administratorPassword,
    });

    registerMutation.mutate(
      { data: payload },
      {
        onSuccess: async (data) => {
          const organizationId =
            typeof (data as { organization?: { id?: unknown } }).organization?.id === "number"
              ? (data as { organization: { id: number } }).organization.id
              : null;
          await login(data.user, data.token, organizationId);
        },
        onError: (error) => {
          setFormError(error instanceof Error ? error.message : "Business registration failed. Please try again.");
        },
      },
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 40,
          paddingHorizontal: 24,
        }}
        bottomOffset={20}
      >
        <Pressable
          testID="button-business-registration-back"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.businessBack}
        >
          <Feather name="arrow-left" size={17} color={colors.primary} />
          <Text style={[styles.businessBackText, { color: colors.primary }]}>Back to account type</Text>
        </Pressable>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground }]}>Create a business account</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Set up the business first, then add the person who administers it.
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={[styles.label, { color: colors.foreground }]}>Business type</Text>
          <View style={styles.businessSubtypeList}>
            {BUSINESS_REGISTRATION_OPTIONS.map((option) => {
              const selected = option.value === subtype;
              return (
                <Pressable
                  key={option.value}
                  testID={`business-subtype-${option.value}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onSubtypeChange(option.value)}
                  style={[
                    styles.businessSubtypeOption,
                    {
                      backgroundColor: selected ? colors.primary + "14" : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.businessSubtypeLabel, { color: selected ? colors.primary : colors.foreground }]}>
                      {option.label}
                    </Text>
                    <Text style={[styles.businessSubtypeDescription, { color: colors.mutedForeground }]}>
                      {option.description}
                    </Text>
                  </View>
                  {selected ? <Feather name="check-circle" size={18} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </View>

          <View style={[styles.businessSection, { borderColor: colors.border }]}>
            <Text style={[styles.businessSectionTitle, { color: colors.foreground }]}>
              Business profile
            </Text>
            <Text style={[styles.businessSectionHint, { color: colors.mutedForeground }]}>
              This information represents the organization and appears to customers.
            </Text>

            <Text style={[styles.label, { color: colors.foreground }]}>Legal business name *</Text>
            <TextInput
              testID="input-business-legal-name"
              style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
              placeholder="Northside Automotive LLC"
              placeholderTextColor={colors.mutedForeground}
              value={legalName}
              onChangeText={(value) => {
                setLegalName(value);
                setAddressVerified(false);
              }}
            />

            <Text style={[styles.label, { color: colors.foreground }]}>Display name / DBA</Text>
            <TextInput
              testID="input-business-display-name"
              style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
              placeholder="Northside Auto"
              placeholderTextColor={colors.mutedForeground}
              value={displayName}
              onChangeText={setDisplayName}
            />

            <Text style={[styles.label, { color: colors.foreground }]}>Business email *</Text>
            <TextInput
              testID="input-business-email"
              style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
              placeholder="service@northsideauto.com"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              value={businessEmail}
              onChangeText={setBusinessEmail}
            />

            <Text style={[styles.label, { color: colors.foreground }]}>Business phone *</Text>
            <TextInput
              testID="input-business-phone"
              style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
              placeholder="(555) 555-1234"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="phone-pad"
              value={businessPhone}
              onChangeText={setBusinessPhone}
            />

            <Text style={[styles.label, { color: colors.foreground }]}>Verified business address *</Text>
            <TextInput
              testID="input-business-address"
              style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
              placeholder="123 Main St"
              placeholderTextColor={colors.mutedForeground}
              value={address}
              onChangeText={(value) => {
                setAddress(value);
                setAddressVerified(false);
              }}
            />
            <View style={styles.row}>
              <View style={{ flex: 2 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>City *</Text>
                <TextInput
                  testID="input-business-city"
                  style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
                  placeholder="Austin"
                  placeholderTextColor={colors.mutedForeground}
                  value={city}
                  onChangeText={(value) => {
                    setCity(value);
                    setAddressVerified(false);
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>Region *</Text>
                <TextInput
                  testID="input-business-region"
                  style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
                  placeholder="TX"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="characters"
                  value={region}
                  onChangeText={(value) => {
                    setRegion(value);
                    setAddressVerified(false);
                  }}
                />
              </View>
            </View>
            <Text style={[styles.label, { color: colors.foreground }]}>ZIP *</Text>
            <TextInput
              testID="input-business-zip"
              style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
              placeholder="78701"
              placeholderTextColor={colors.mutedForeground}
              keyboardType={Platform.OS === "web" ? "default" : "number-pad"}
              value={zipCode}
              onChangeText={(value) => {
                setZipCode(value);
                setAddressVerified(false);
              }}
            />
            <Pressable
              testID="button-verify-business-address"
              accessibilityRole="button"
              onPress={verifyBusinessAddress}
              disabled={verifyingAddress}
              style={[
                styles.verifyBtn,
                {
                  backgroundColor: addressVerified ? colors.primary + "22" : colors.secondary,
                  borderColor: addressVerified ? colors.primary : colors.border,
                },
              ]}
            >
              {verifyingAddress ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <>
                  <Feather name={addressVerified ? "check-circle" : "map-pin"} size={16} color={colors.primary} />
                  <Text style={[styles.verifyText, { color: colors.primary }]}>
                    {addressVerified ? "Business address verified" : "Verify business address"}
                  </Text>
                </>
              )}
            </Pressable>
            {addressError ? <Text style={[styles.error, { color: colors.destructive }]}>{addressError}</Text> : null}
          </View>

          <View style={[styles.businessSection, { borderColor: colors.border }]}>
            <Text style={[styles.businessSectionTitle, { color: colors.foreground }]}>
              Primary owner / admin
            </Text>
            <Text style={[styles.businessSectionHint, { color: colors.mutedForeground }]}>
              This login administers the business. It is separate from the business contact information above.
            </Text>

            <Text style={[styles.label, { color: colors.foreground }]}>Name *</Text>
            <TextInput
              testID="input-administrator-name"
              style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
              placeholder="Alex Morgan"
              placeholderTextColor={colors.mutedForeground}
              value={administratorName}
              onChangeText={setAdministratorName}
            />
            <Text style={[styles.label, { color: colors.foreground }]}>Login email *</Text>
            <TextInput
              testID="input-administrator-email"
              style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
              placeholder="alex@example.com"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              value={administratorEmail}
              onChangeText={setAdministratorEmail}
            />
            <Text style={[styles.label, { color: colors.foreground }]}>Phone</Text>
            <TextInput
              testID="input-administrator-phone"
              style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
              placeholder="(555) 555-9876"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="phone-pad"
              value={administratorPhone}
              onChangeText={setAdministratorPhone}
            />
            <Text style={[styles.label, { color: colors.foreground }]}>Password *</Text>
            <TextInput
              testID="input-administrator-password"
              style={[styles.input, { backgroundColor: colors.card, color: colors.cardForeground, borderColor: colors.border }]}
              placeholder="Create a secure password"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
              value={administratorPassword}
              onChangeText={setAdministratorPassword}
            />
          </View>

          {formError ? <Text style={[styles.error, { color: colors.destructive }]}>{formError}</Text> : null}
          {registerMutation.isError && !formError ? (
            <Text style={[styles.error, { color: colors.destructive }]}>
              Business registration failed. Please check the details and try again.
            </Text>
          ) : null}
          <Pressable
            testID="button-register-business"
            accessibilityRole="button"
            style={[styles.button, { backgroundColor: colors.primary }, registerMutation.isPending && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={registerMutation.isPending}
          >
            {registerMutation.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Create business account</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>Already have an account?</Text>
          <Link href="/(auth)/login" asChild>
            <Pressable>
              <Text style={[styles.link, { color: colors.primary }]}>Sign In</Text>
            </Pressable>
          </Link>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: "center", marginBottom: 32, marginTop: 12 },
  title: { fontSize: 32, fontWeight: "700" },
  subtitle: { fontSize: 16, fontWeight: "500", marginTop: 8 },
  form: { gap: 16 },
  label: { fontSize: 14, fontWeight: "600", marginBottom: -8 },
  input: { height: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, fontSize: 16 },
  roleContainer: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  roleButton: { flexGrow: 1, minWidth: 96, minHeight: 48, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  roleText: { fontSize: 15, fontWeight: "600" },
  row: { flexDirection: "row", gap: 12 },
  sectionDivider: { borderTopWidth: 1, paddingTop: 16, marginTop: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "700" },
  sectionHint: { fontSize: 13, marginTop: 4 },
  verifyBtn: {
    height: 48, borderRadius: 12, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 8,
  },
  verifyText: { fontSize: 14, fontWeight: "600" },
  manualAddressBtn: {
    minHeight: 48, borderRadius: 12, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 8,
  },
  manualAddressNotice: {
    borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 8,
    padding: 10,
  },
  manualAddressText: { flex: 1, fontSize: 12, lineHeight: 17 },
  verifiedAddress: { fontSize: 12, marginTop: -8 },
  radiusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  radiusChip: { paddingHorizontal: 16, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  radiusChipText: { fontSize: 14, fontWeight: "600" },
  button: { height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 16 },
  buttonText: { fontSize: 16, fontWeight: "700" },
  error: { fontSize: 14, marginTop: -8 },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 32, gap: 8 },
  footerText: { fontSize: 14 },
  link: { fontSize: 14, fontWeight: "600" },
  businessBack: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 8 },
  businessBackText: { fontSize: 14, fontWeight: "600" },
  businessSubtypeList: { gap: 8 },
  businessSubtypeOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  businessSubtypeLabel: { fontSize: 14, fontWeight: "700" },
  businessSubtypeDescription: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  businessSection: { borderTopWidth: 1, paddingTop: 16, marginTop: 8, gap: 8 },
  businessSectionTitle: { fontSize: 17, fontWeight: "700" },
  businessSectionHint: { fontSize: 13, lineHeight: 18, marginBottom: 3 },
});
