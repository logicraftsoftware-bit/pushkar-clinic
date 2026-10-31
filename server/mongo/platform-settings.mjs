export const platformSettingDefaults = [
  {key:'platform_name',value:'Pushkar Clinic ERP',category:'branding',is_public:true,description:'Name displayed on login screens and navigation.'},
  {key:'platform_logo',value:'/branding/pushkar-logo.png',category:'branding',is_public:true,description:'Logo displayed on login screens and navigation.'},
  {key:'support_email',value:'',category:'general',is_public:false,description:'Contact email for platform support.'},
  {key:'trial_days',value:14,category:'general',is_public:false,description:'Platform trial preference. Select the actual trial duration when provisioning each clinic.'},
  {key:'maintenance_mode',value:false,category:'general',is_public:true,description:'Stored maintenance preference; changing it does not stop running clinic sessions.'},
  {key:'session_timeout_minutes',value:60,category:'general',is_public:false,description:'Stored session preference. Active token lifetime follows the server authentication configuration.'},
];

// Return editable defaults even before the first save. Never overwrite saved data.
export function platformSettingsWithDefaults(saved) {
  const values = new Map(saved.map(row => [row.key,row]));
  return platformSettingDefaults.map(defaults => ({...defaults,...values.get(defaults.key)}));
}
